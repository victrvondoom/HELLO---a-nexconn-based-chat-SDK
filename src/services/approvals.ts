import { DomainError } from '../domain/errors';
import { ACTION_LEVELS, APPROVAL_TTL_MS, assertCanDecide, assertCanExecute, requiresApproval } from '../domain/approvals/rules';
import type { ApprovalRequest, ConsequentialActionType, Session } from '../domain/types';
import { VersionConflictError } from '../store/store';
import { audit, notify, requireCapability, type ServiceContext } from './context';

/**
 * The approval queue and the executors for consequential actions.
 *
 * Approval and execution are recorded separately. Approving an action moves it to
 * APPROVED. Execution then runs its own validation and writes its own result, which
 * can be SUCCEEDED or FAILED. An approved action can therefore still fail, and the
 * UI shows both facts.
 */

/** Pseudo-user for proposals raised automatically by HELLO's own coordination logic. */
export const SYSTEM_ACTOR_ID = 'system:hello-coordinator';

const REQUIRED_PAYLOAD: Partial<Record<ConsequentialActionType, string[]>> = {
  MOVE_SESSION_ROOM: ['sessionId', 'toRoomId'],
  PUBLISH_ANNOUNCEMENT: ['title', 'body'],
  CANCEL_SESSION: ['sessionId'],
  REASSIGN_STAFF: ['incidentId', 'toUserId'],
};

export function validatePayload(actionType: ConsequentialActionType, payload: Record<string, string>): void {
  for (const key of REQUIRED_PAYLOAD[actionType] ?? []) {
    const value = payload[key];
    if (!value || value.trim().length === 0) {
      throw new DomainError('VALIDATION_FAILED', `The ${actionType} request is missing "${key}".`);
    }
  }
}

export interface RequestApprovalInput {
  eventId: string;
  /** A user id, or SYSTEM_ACTOR_ID for proposals raised by HELLO itself. */
  requestedByUserId: string;
  actionType: ConsequentialActionType;
  payload: Record<string, string>;
  justification: string;
  linkedIncidentId: string | null;
}

export async function requestApproval(ctx: ServiceContext, input: RequestApprovalInput): Promise<ApprovalRequest> {
  if (!requiresApproval(input.actionType)) {
    throw new DomainError('VALIDATION_FAILED', `${input.actionType} does not need approval.`);
  }
  if (input.requestedByUserId !== SYSTEM_ACTOR_ID) {
    await requireCapability(ctx, input.eventId, input.requestedByUserId, 'approval.request');
  }
  validatePayload(input.actionType, input.payload);

  const now = ctx.now();
  // The same pending request is never queued twice. Repeated reports would otherwise flood the organiser queue.
  const existing = (await ctx.store.listApprovals(input.eventId)).find(
    (a) =>
      a.status === 'PENDING' &&
      a.actionType === input.actionType &&
      JSON.stringify(a.payload) === JSON.stringify(input.payload),
  );
  if (existing) {
    return existing;
  }

  const approval: ApprovalRequest = {
    id: ctx.newId('apr'),
    eventId: input.eventId,
    actionType: input.actionType,
    payload: input.payload,
    justification: input.justification,
    requestedByUserId: input.requestedByUserId,
    status: 'PENDING',
    expiresAt: now + APPROVAL_TTL_MS,
    decidedByUserId: null,
    decidedAt: null,
    decisionReason: null,
    executionStatus: 'NOT_STARTED',
    executionResult: null,
    executedAt: null,
    linkedIncidentId: input.linkedIncidentId,
    version: 0,
  };
  await ctx.store.insertApproval(approval);
  await audit(ctx, input.eventId, input.requestedByUserId === SYSTEM_ACTOR_ID ? null : input.requestedByUserId, 'approval.requested', 'approval', approval.id, `${input.actionType} requested.`);

  if (input.linkedIncidentId) {
    await ctx.store.appendTimeline({
      id: ctx.newId('tl'),
      incidentId: input.linkedIncidentId,
      eventId: input.eventId,
      type: 'APPROVAL_REQUESTED',
      actorUserId: input.requestedByUserId === SYSTEM_ACTOR_ID ? null : input.requestedByUserId,
      fromStatus: null,
      toStatus: null,
      detail: `Organiser approval requested for ${input.actionType}.`,
      at: now,
    });
  }

  const memberships = await ctx.store.listMemberships(input.eventId);
  for (const m of memberships.filter((x) => x.role === 'ORGANISER')) {
    await notify(ctx, {
      eventId: input.eventId,
      recipientUserId: m.userId,
      kind: 'APPROVAL_REQUESTED',
      body: `Approval needed: ${input.actionType}. ${input.justification}`,
      href: `/events/${input.eventId}/operations/approvals`,
      dedupeParts: [approval.id],
    });
  }
  return approval;
}

export interface DecideInput {
  eventId: string;
  actorUserId: string;
  approvalId: string;
  decision: 'APPROVE' | 'REJECT';
  reason: string;
  expectedVersion: number;
}

export async function decideApproval(ctx: ServiceContext, input: DecideInput): Promise<ApprovalRequest> {
  const membership = await ctx.store.findMembership(input.eventId, input.actorUserId);
  const approval = await loadApproval(ctx, input.eventId, input.approvalId);
  const now = ctx.now();

  if (approval.status === 'PENDING' && now >= approval.expiresAt) {
    await ctx.store.updateApproval(approval.id, approval.version, { status: 'EXPIRED' });
    throw new DomainError('APPROVAL_NOT_DECIDABLE', 'This approval request has expired.');
  }
  assertCanDecide(membership, approval, now);

  if (approval.version !== input.expectedVersion) {
    throw new VersionConflictError('approval request');
  }

  if (input.decision === 'REJECT') {
    if (input.reason.trim().length < 3) {
      throw new DomainError('VALIDATION_FAILED', 'Give a reason for rejecting the request.');
    }
    const rejected = await ctx.store.updateApproval(approval.id, approval.version, {
      status: 'REJECTED',
      decidedByUserId: input.actorUserId,
      decidedAt: now,
      decisionReason: input.reason.trim(),
    });
    await audit(ctx, input.eventId, input.actorUserId, 'approval.rejected', 'approval', approval.id, input.reason.trim());
    await notifyRequester(ctx, rejected, `Your ${rejected.actionType} request was rejected: ${input.reason.trim()}`);
    return rejected;
  }

  const approved = await ctx.store.updateApproval(approval.id, approval.version, {
    status: 'APPROVED',
    decidedByUserId: input.actorUserId,
    decidedAt: now,
    decisionReason: input.reason.trim() || null,
  });
  await audit(ctx, input.eventId, input.actorUserId, 'approval.approved', 'approval', approval.id, `${approval.actionType} approved.`);
  await notifyRequester(ctx, approved, `Your ${approved.actionType} request was approved. Execution is being recorded.`);

  // Execution is attempted immediately after approval, but its result is written separately.
  return executeApproval(ctx, input.eventId, input.actorUserId, approval.id);
}

async function loadApproval(ctx: ServiceContext, eventId: string, approvalId: string): Promise<ApprovalRequest> {
  const approval = await ctx.store.getApproval(approvalId);
  if (!approval || approval.eventId !== eventId) {
    throw new DomainError('NOT_FOUND', 'Approval request not found.');
  }
  return approval;
}

export async function executeApproval(
  ctx: ServiceContext,
  eventId: string,
  actorUserId: string,
  approvalId: string,
): Promise<ApprovalRequest> {
  const approval = await loadApproval(ctx, eventId, approvalId);
  assertCanExecute(approval);

  let outcome: { ok: true; result: string; linkedMessage?: string } | { ok: false; result: string };
  try {
    outcome = await runExecutor(ctx, approval);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown execution error.';
    outcome = { ok: false, result: message };
  }

  const executed = await ctx.store.updateApproval(approval.id, approval.version, {
    executionStatus: outcome.ok ? 'SUCCEEDED' : 'FAILED',
    executionResult: outcome.result,
    executedAt: ctx.now(),
  });
  await audit(ctx, eventId, actorUserId, outcome.ok ? 'approval.executed' : 'approval.execution_failed', 'approval', approval.id, outcome.result);

  if (approval.linkedIncidentId) {
    await ctx.store.appendTimeline({
      id: ctx.newId('tl'),
      incidentId: approval.linkedIncidentId,
      eventId,
      type: 'NOTE',
      actorUserId,
      fromStatus: null,
      toStatus: null,
      detail: outcome.ok ? `Approved action executed: ${outcome.result}` : `Approved action failed: ${outcome.result}`,
      at: ctx.now(),
    });
  }
  await notifyRequester(
    ctx,
    executed,
    outcome.ok ? `Done: ${outcome.result}` : `The approved ${executed.actionType} could not be completed: ${outcome.result}`,
  );
  return executed;
}

async function runExecutor(
  ctx: ServiceContext,
  approval: ApprovalRequest,
): Promise<{ ok: true; result: string } | { ok: false; result: string }> {
  const { eventId } = approval;
  switch (approval.actionType) {
    case 'MOVE_SESSION_ROOM': {
      const sessionId = approval.payload.sessionId ?? '';
      const toRoomId = approval.payload.toRoomId ?? '';
      const session = await ctx.store.getSession(sessionId);
      if (!session || session.eventId !== eventId) {
        return { ok: false, result: 'The session no longer exists.' };
      }
      const room = await ctx.store.getRoom(toRoomId);
      if (!room || room.eventId !== eventId) {
        return { ok: false, result: 'The target room no longer exists.' };
      }
      if (room.capacity < session.enrolled) {
        return { ok: false, result: `${room.name} holds ${room.capacity}, but ${session.enrolled} people are enrolled.` };
      }
      if (session.accessible && !room.accessible) {
        return { ok: false, result: `${room.name} is not accessible, and this session is marked accessible.` };
      }
      const sessions = await ctx.store.listSessions(eventId);
      const clash = sessions.find((s) => s.roomId === toRoomId && s.id !== session.id && overlaps(s, session));
      if (clash) {
        return { ok: false, result: `${room.name} is already booked by "${clash.title}" at that time.` };
      }
      await ctx.store.updateSession(sessionId, { roomId: toRoomId });
      return { ok: true, result: `"${session.title}" moved to ${room.name}.` };
    }
    case 'PUBLISH_ANNOUNCEMENT': {
      await ctx.store.insertAnnouncement({
        id: ctx.newId('ann'),
        eventId,
        title: approval.payload.title ?? '',
        body: approval.payload.body ?? '',
        publishedByUserId: approval.decidedByUserId ?? approval.requestedByUserId,
        publishedAt: ctx.now(),
      });
      return { ok: true, result: `Announcement "${approval.payload.title ?? ''}" published.` };
    }
    default:
      // Honest failure: the approval is recorded, but no executor exists for this action yet.
      return {
        ok: false,
        result: `No executor is implemented for ${approval.actionType} in this build (level ${ACTION_LEVELS[approval.actionType] ?? 'LEVEL_3'}).`,
      };
  }
}

function overlaps(a: Session, b: Session): boolean {
  return a.startsAt < b.endsAt && b.startsAt < a.endsAt;
}

async function notifyRequester(ctx: ServiceContext, approval: ApprovalRequest, body: string): Promise<void> {
  if (approval.requestedByUserId === SYSTEM_ACTOR_ID) return;
  await notify(ctx, {
    eventId: approval.eventId,
    recipientUserId: approval.requestedByUserId,
    kind: 'APPROVAL_DECISION',
    body,
    href: `/events/${approval.eventId}/operations/approvals`,
    dedupeParts: [approval.id, approval.status, approval.executionStatus, approval.version],
  });
}

export async function listApprovalsForViewer(ctx: ServiceContext, eventId: string, userId: string): Promise<ApprovalRequest[]> {
  await requireCapability(ctx, eventId, userId, 'approval.request');
  return (await ctx.store.listApprovals(eventId)).sort((a, b) => b.expiresAt - a.expiresAt);
}
