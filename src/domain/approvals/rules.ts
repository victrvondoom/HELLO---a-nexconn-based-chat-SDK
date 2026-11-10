import { DomainError } from '../errors';
import type { ApprovalRequest, Membership } from '../types';

/**
 * Trust levels for actions HELLO can take or suggest.
 *
 * LEVEL_1: informational. Answered from verified data, no state change.
 * LEVEL_2: reversible coordination. May happen automatically, within permissions.
 * LEVEL_3: consequential. Requires an approval by an organiser before execution.
 */
export type ActionLevel = 'LEVEL_1' | 'LEVEL_2' | 'LEVEL_3';

export const ACTION_LEVELS: Record<string, ActionLevel> = {
  ANSWER_EVENT_QUESTION: 'LEVEL_1',
  EXPLAIN_SCHEDULE: 'LEVEL_1',
  FIND_ROOM: 'LEVEL_1',
  CREATE_HELP_REQUEST: 'LEVEL_2',
  NOTIFY_VOLUNTEER: 'LEVEL_2',
  SUGGEST_ALTERNATIVE_SESSION: 'LEVEL_2',
  MOVE_SESSION_ROOM: 'LEVEL_3',
  PUBLISH_ANNOUNCEMENT: 'LEVEL_3',
  CANCEL_SESSION: 'LEVEL_3',
  REASSIGN_STAFF: 'LEVEL_3',
};

/** Default time an approval stays decidable before it expires. */
export const APPROVAL_TTL_MS = 2 * 60 * 60 * 1000;

export function actionLevel(actionType: string): ActionLevel {
  return ACTION_LEVELS[actionType] ?? 'LEVEL_3';
}

export function requiresApproval(actionType: string): boolean {
  return actionLevel(actionType) === 'LEVEL_3';
}

/**
 * Whether `decider` may approve or reject `approval` right now.
 * Four-eyes rule: the requester can never decide their own request.
 */
export function assertCanDecide(
  decider: Membership | null,
  approval: ApprovalRequest,
  now: number,
): void {
  if (!decider || decider.eventId !== approval.eventId) {
    throw new DomainError('FORBIDDEN', 'Only a member of this event can decide an approval.');
  }
  if (decider.role !== 'ORGANISER') {
    throw new DomainError('FORBIDDEN', 'Only organisers can approve consequential actions.');
  }
  if (decider.userId === approval.requestedByUserId) {
    throw new DomainError('FORBIDDEN', 'You cannot approve a request you submitted.');
  }
  if (approval.status !== 'PENDING') {
    throw new DomainError('APPROVAL_NOT_DECIDABLE', `This approval is already ${approval.status.toLowerCase()}.`);
  }
  if (now >= approval.expiresAt) {
    throw new DomainError('APPROVAL_NOT_DECIDABLE', 'This approval request has expired.');
  }
}

/**
 * Execution is a separate step. It is allowed only after approval. A succeeded
 * execution is never repeated. A failed one may be retried, because every executor
 * validates before it writes, so a failed attempt has changed nothing.
 */
export function assertCanExecute(approval: ApprovalRequest): void {
  if (approval.status !== 'APPROVED') {
    throw new DomainError('EXECUTION_NOT_ALLOWED', 'Only approved actions can be executed.');
  }
  if (approval.executionStatus === 'SUCCEEDED') {
    throw new DomainError('EXECUTION_NOT_ALLOWED', 'This approved action has already been executed.');
  }
}

export function isExpired(approval: ApprovalRequest, now: number): boolean {
  return approval.status === 'PENDING' && now >= approval.expiresAt;
}
