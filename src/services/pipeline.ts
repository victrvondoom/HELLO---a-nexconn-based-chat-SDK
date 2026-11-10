import { interpretMessage, type Intent, type IntentResult, type InterpretationSource, type FallbackReason } from '../ai/intent';
import { authorize } from '../domain/permissions';
import { classifyUtterance, resolveRoomName } from '../domain/incidents/classify';
import { DomainError } from '../domain/errors';
import type { IncidentCategory, Room, Session, Urgency, Membership, IncidentStatus } from '../domain/types';
import type { RecommendationResult } from '../domain/sessions/recommend';
import type { AssignmentScore } from '../domain/assignments/scoring';
import { actionLevel } from '../domain/approvals/rules';
import type { PersonMatch } from './people';
import { discoverPeople } from './people';
import { recommendAlternatives } from './sessions';
import { ingestReport, listIncidentsForViewer, recommendAssignees, STATUS_LABEL, ROOM_SCOPED } from './incidents';
import { requestApproval, SYSTEM_ACTOR_ID, validatePayload } from './approvals';
import { requireCapability, type ServiceContext } from './context';

export const MAX_MESSAGE_LENGTH = 2000;

/** What the assistant said and created for one message. Persisted with the message. */
export interface StoredOutcome {
  reply: string;
  clarifyingQuestion: string | null;
  incidents: Array<{
    incidentId: string;
    title: string;
    category: IncidentCategory;
    status: IncidentStatus;
    urgency: Urgency;
    attached: boolean;
    matchConfidence: number | null;
  }>;
  alternatives: Array<{ sessionId: string; title: string; roomName: string; startsAt: number; reasons: string[] }>;
  approvalId: string | null;
  statusReport: MessageResponse['statusReport'];
  people: Array<{ userId: string; displayName: string; reason: string }>;
}

export interface IncidentOutcome {
  incidentId: string;
  title: string;
  category: IncidentCategory;
  status: IncidentStatus;
  urgency: Urgency;
  attached: boolean;
  matchConfidence: number | null;
  matchSignals: string[];
  reportId: string;
}

export interface MessageResponse {
  messageId: string;
  interpretation: {
    intent: Intent;
    category: IncidentCategory | null;
    urgency: Urgency;
    entities: string[];
    confidence: number;
    source: InterpretationSource;
    fallbackReason: FallbackReason | null;
  };
  room: { id: string; name: string } | null;
  incidents: IncidentOutcome[];
  /** Only populated for operational viewers. Attendees never see staff rankings. */
  recommendedAssignees: AssignmentScore[];
  alternatives: RecommendationResult | null;
  statusReport: {
    incidentId: string;
    title: string;
    status: IncidentStatus;
    statusLabel: string;
    assigneeName: string | null;
    minutesSinceUpdate: number;
  } | null;
  people: PersonMatch[];
  approval: { id: string; actionType: string; status: string; level: string } | null;
  missingInformation: string[];
  clarifyingQuestion: string | null;
  reply: string;
}

export interface SendMessageInput {
  eventId: string;
  userId: string;
  text: string;
}

function formatUtc(ms: number): string {
  return `${new Date(ms).toISOString().slice(11, 16)} UTC`;
}

const URGENCY_ORDER: Urgency[] = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
function maxUrgency(a: Urgency, b: Urgency): Urgency {
  return URGENCY_ORDER.indexOf(a) >= URGENCY_ORDER.indexOf(b) ? a : b;
}

/**
 * The unified conversation pipeline. Each step either adds structured facts or
 * routes to a permitted action. The model's output only chooses the route.
 * Every state change goes through a domain service with its own checks.
 */
export async function handleMessage(ctx: ServiceContext, input: SendMessageInput): Promise<MessageResponse> {
  const text = input.text.trim();
  if (text.length === 0 || text.length > MAX_MESSAGE_LENGTH) {
    throw new DomainError('VALIDATION_FAILED', `Messages must be between 1 and ${MAX_MESSAGE_LENGTH} characters.`);
  }

  // 1. Identify the user and the active event. Membership is checked on the server.
  const membership = await requireCapability(ctx, input.eventId, input.userId, 'message.send');
  const operational = authorize(membership, 'incident.read.operational', input.eventId).allowed;

  // 2–5. Resolve rooms, classify intent, extract structured details.
  const rooms = await ctx.store.listRooms(input.eventId);
  const interpreted = await interpretMessage(
    { text, roomNames: rooms.map((r) => r.name) },
    { provider: ctx.intentProvider, timeoutMs: ctx.intentTimeoutMs },
  );
  const result: IntentResult = interpreted.result;
  const classification = classifyUtterance(text);
  const room = resolveRoomName(text, rooms) ?? (result.roomHint ? resolveRoomName(result.roomHint, rooms) : null);

  const base = {
    messageId: ctx.newId('msg'),
    interpretation: {
      intent: result.intent,
      category: result.category,
      urgency: result.urgency,
      entities: result.entities,
      confidence: result.confidence,
      source: interpreted.source,
      fallbackReason: interpreted.fallbackReason,
    },
    room: room ? { id: room.id, name: room.name } : null,
  };

  let outcome: Omit<MessageResponse, 'messageId' | 'interpretation' | 'room'>;
  let linkedIncidentId: string | null = null;
  let linkedApprovalId: string | null = null;

  switch (result.intent) {
    case 'REPORT_INCIDENT':
    case 'REQUEST_ASSISTANCE':
    case 'SCHEDULE_CONFLICT': {
      const handled = await handleReports(ctx, input, result, classification, room, operational);
      outcome = handled.response;
      linkedIncidentId = handled.linkedIncidentId;
      linkedApprovalId = handled.linkedApprovalId;
      break;
    }
    case 'STATUS_CHECK':
      outcome = await handleStatusCheck(ctx, input, room);
      break;
    case 'FIND_PERSON':
      outcome = await handleFindPerson(ctx, input);
      break;
    case 'CONSEQUENTIAL_REQUEST': {
      const handled = await handleConsequential(ctx, input, text, membership);
      outcome = handled.response;
      linkedApprovalId = handled.linkedApprovalId;
      break;
    }
    case 'ASK_QUESTION':
      outcome = await handleQuestion(ctx, input, room);
      break;
  }

  // The assistant's answer is stored with the message, so the conversation survives a reload and
  // every card the attendee saw can be rebuilt from the record instead of from client state.
  const outcomeSummary: StoredOutcome = {
    reply: outcome.reply,
    clarifyingQuestion: outcome.clarifyingQuestion,
    incidents: outcome.incidents.map((i) => ({
      incidentId: i.incidentId,
      title: i.title,
      category: i.category,
      status: i.status,
      urgency: i.urgency,
      attached: i.attached,
      matchConfidence: i.matchConfidence,
    })),
    alternatives: (outcome.alternatives?.recommendations ?? []).map((r) => ({
      sessionId: r.sessionId,
      title: r.title,
      roomName: r.roomName,
      startsAt: r.startsAt,
      reasons: r.reasons.slice(0, 2),
    })),
    approvalId: outcome.approval?.id ?? null,
    statusReport: outcome.statusReport,
    people: outcome.people.map((p) => ({ userId: p.userId, displayName: p.displayName, reason: p.reason })),
  };

  await ctx.store.insertMessage({
    id: base.messageId,
    eventId: input.eventId,
    senderUserId: input.userId,
    text,
    createdAt: ctx.now(),
    interpretation: {
      ...base.interpretation,
      classificationSignals: classification.matchedSignals,
      outcome: outcomeSummary,
    },
    linkedIncidentId,
    linkedApprovalId,
  });

  return { ...base, ...outcome };
}

type Outcome = Omit<MessageResponse, 'messageId' | 'interpretation' | 'room'>;

function emptyOutcome(reply: string, clarifyingQuestion: string | null = null): Outcome {
  return {
    incidents: [],
    recommendedAssignees: [],
    alternatives: null,
    statusReport: null,
    people: [],
    approval: null,
    missingInformation: [],
    clarifyingQuestion,
    reply,
  };
}

async function handleReports(
  ctx: ServiceContext,
  input: SendMessageInput,
  result: IntentResult,
  classification: ReturnType<typeof classifyUtterance>,
  room: Room | null,
  operational: boolean,
): Promise<{ response: Outcome; linkedIncidentId: string | null; linkedApprovalId: string | null }> {
  // A single message may raise several concerns, e.g. AV and CAPACITY. Each becomes its own incident.
  const wanted = new Set<IncidentCategory>();
  if (result.intent === 'SCHEDULE_CONFLICT') wanted.add('SCHEDULE');
  if (result.intent === 'REQUEST_ASSISTANCE') wanted.add('GENERAL');
  for (const c of classification.categories) if (c !== 'GENERAL') wanted.add(c);
  if (result.category && result.category !== 'GENERAL') wanted.add(result.category);
  if (wanted.size === 0) wanted.add('GENERAL');
  const categories = [...wanted].slice(0, 3);

  const outcomes: IncidentOutcome[] = [];
  const missing = new Set<string>();
  let urgency: Urgency = result.urgency;
  let linkedApprovalId: string | null = null;
  let recommendedAssignees: AssignmentScore[] = [];
  let alternatives: RecommendationResult | null = null;

  const roomName = room?.name ?? null;

  for (const category of categories) {
    const roomFull = room !== null && room.occupancy !== null && room.occupancy > room.capacity;
    const verifiedFull = roomFull && (room.occupancySource === 'LIVE_VERIFIED' || room.occupancySource === 'ADMIN_ENTERED');
    const ingested = await ingestReport(ctx, {
      eventId: input.eventId,
      reporterUserId: input.userId,
      text: input.text.trim(),
      category,
      urgency: maxUrgency(result.urgency, classification.urgency),
      roomId: room?.id ?? null,
      roomName,
      equipment: classification.equipment,
      overcrowded: verifiedFull && category === 'CAPACITY',
    });
    urgency = maxUrgency(urgency, ingested.incident.urgency);

    const isNewIncident = !ingested.attached;
    const reporters = await ctx.store.listReportsForIncident(ingested.incident.id);
    const distinctReporters = new Set(reporters.map((r) => r.reporterUserId)).size;

    outcomes.push({
      incidentId: ingested.incident.id,
      title: ingested.incident.title,
      category,
      status: ingested.incident.status,
      urgency: ingested.incident.urgency,
      attached: ingested.attached,
      matchConfidence: ingested.duplicate?.confidence ?? null,
      matchSignals: ingested.duplicate?.signals ?? [],
      reportId: ingested.reportId,
    });

    if (ROOM_SCOPED.has(category) && room === null) {
      missing.add('room');
    }

    // Capacity concerns with a room: recommend alternatives, and propose a consequential move only with evidence.
    if (category === 'CAPACITY' && room) {
      const alt = await recommendAlternatives(ctx, input.eventId, input.userId, await currentSessionIdIn(ctx, input.eventId, room.id));
      alternatives = alt;
      const proposal = await proposeRoomMove(ctx, input, room, distinctReporters, ingested.incident.id);
      if (proposal) linkedApprovalId = proposal;
    }

    if (isNewIncident && operational) {
      recommendedAssignees = await recommendAssignees(
        ctx,
        ingested.incident,
        await ctx.store.listMemberships(input.eventId),
        await namesFor(ctx, input.eventId),
      );
    }
  }

  // The reply states what HELLO did in plain sentences. Detail lives in the cards under it.
  const attachedOutcomes = outcomes.filter((o) => o.attached);
  const newOutcomes = outcomes.filter((o) => !o.attached && o.status !== 'NEEDS_INFORMATION');
  const needRoom = outcomes.filter((o) => o.status === 'NEEDS_INFORMATION');
  const lines: string[] = [];
  if (attachedOutcomes.length === 1 && attachedOutcomes[0]) {
    lines.push(`Added to the open report "${attachedOutcomes[0].title}".`);
  } else if (attachedOutcomes.length > 1) {
    lines.push(`Added to ${attachedOutcomes.length} open reports.`);
  }
  for (const o of newOutcomes) {
    lines.push(`Opened "${o.title}" for the operations team.`);
  }
  for (const o of needRoom) {
    lines.push(`I need the room before operations can act on "${o.title}".`);
  }
  if (newOutcomes.length > 0) {
    lines.push('You will be told when the status changes.');
  }
  if (alternatives && alternatives.recommendations.length > 0) {
    lines.push(`${alternatives.recommendations.length} sessions with free seats are listed below.`);
  }
  if (linkedApprovalId) {
    lines.push('A room change is waiting for organiser approval. Nothing has moved yet.');
  }

  const clarifyingQuestion = missing.has('room') ? 'Which room is this in? For example "Room 3" or "Main Hall".' : null;

  return {
    response: {
      incidents: outcomes,
      recommendedAssignees,
      alternatives,
      statusReport: null,
      people: [],
      approval: linkedApprovalId
        ? { id: linkedApprovalId, actionType: 'MOVE_SESSION_ROOM', status: 'PENDING', level: actionLevel('MOVE_SESSION_ROOM') }
        : null,
      missingInformation: [...missing],
      clarifyingQuestion,
      reply: lines.join(' '),
    },
    linkedIncidentId: outcomes[0]?.incidentId ?? null,
    linkedApprovalId,
  };
}

async function namesFor(ctx: ServiceContext, eventId: string): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  for (const m of await ctx.store.listMemberships(eventId)) {
    const user = await ctx.store.getUser(m.userId);
    if (user) map.set(m.userId, user.displayName);
  }
  return map;
}

async function currentSessionIdIn(ctx: ServiceContext, eventId: string, roomId: string): Promise<string | null> {
  const now = ctx.now();
  const sessions = (await ctx.store.listSessions(eventId)).filter((s) => s.roomId === roomId && s.endsAt > now);
  sessions.sort((a, b) => a.startsAt - b.startsAt);
  return sessions[0]?.id ?? null;
}

/**
 * Proposes moving the session currently in an overcrowded room to a larger free room.
 * Only with evidence: verified occupancy, or at least two distinct reporters. Never executed
 * from here. The proposal becomes an approval request that an organiser must decide.
 */
async function proposeRoomMove(
  ctx: ServiceContext,
  input: SendMessageInput,
  room: Room,
  distinctReporters: number,
  incidentId: string,
): Promise<string | null> {
  // Both conditions are needed: a recorded over-capacity figure AND several independent reporters.
  const overCapacity = room.occupancy !== null && room.occupancy > room.capacity;
  if (!overCapacity || distinctReporters < 2 || room.occupancySource === null) {
    return null;
  }
  const sessionId = await currentSessionIdIn(ctx, input.eventId, room.id);
  if (!sessionId) return null;
  const session = await ctx.store.getSession(sessionId);
  if (!session) return null;
  const target = await findTargetRoom(ctx, input.eventId, session);
  if (!target) return null;

  const payload = { sessionId: session.id, toRoomId: target.id };
  validatePayload('MOVE_SESSION_ROOM', payload);
  const approval = await requestApproval(ctx, {
    eventId: input.eventId,
    requestedByUserId: SYSTEM_ACTOR_ID,
    actionType: 'MOVE_SESSION_ROOM',
    payload,
    justification: `${distinctReporters} independent reports of overcrowding in ${room.name}. Occupancy ${room.occupancy} of ${room.capacity} (source: ${room.occupancySource}). Session "${session.title}" has ${session.enrolled} enrolled.`,
    linkedIncidentId: incidentId,
  });
  return approval.id;
}

/** Finds the smallest room that holds the session's enrolment, is accessible if needed, and is free at that time. */
async function findTargetRoom(ctx: ServiceContext, eventId: string, session: Session): Promise<Room | null> {
  const rooms = await ctx.store.listRooms(eventId);
  const sessions = await ctx.store.listSessions(eventId);
  const candidates = rooms
    .filter((r) => r.id !== session.roomId)
    .filter((r) => r.capacity >= session.enrolled)
    .filter((r) => !session.accessible || r.accessible)
    .filter((r) => !sessions.some((s) => s.roomId === r.id && s.id !== session.id && s.startsAt < session.endsAt && session.startsAt < s.endsAt))
    .sort((a, b) => a.capacity - b.capacity);
  return candidates[0] ?? null;
}

async function handleStatusCheck(ctx: ServiceContext, input: SendMessageInput, room: Room | null): Promise<Outcome> {
  const mine = await listIncidentsForViewer(ctx, input.eventId, input.userId);
  const candidates = mine
    .filter((row) => row.isMine)
    .filter((row) => room === null || row.incident.roomId === room.id)
    .sort((a, b) => b.incident.updatedAt - a.incident.updatedAt);
  const latest = candidates[0];
  if (!latest) {
    return emptyOutcome(
      'I cannot find a report from you that matches this. If the problem is still happening, describe it and I will log it.',
    );
  }
  const incident = latest.incident;
  const assignee = incident.assigneeUserId ? await ctx.store.getUser(incident.assigneeUserId) : null;
  const now = ctx.now();
  const minutes = Math.max(0, Math.round((now - incident.updatedAt) / 60000));
  const statusLabel = STATUS_LABEL[incident.status];
  const who = assignee ? `${assignee.displayName} is handling it` : 'nobody has claimed it yet';
  return {
    ...emptyOutcome(
      `"${incident.title}" is ${statusLabel.toLowerCase()}. ${who}. Last update ${minutes} minute${minutes === 1 ? '' : 's'} ago.`,
    ),
    statusReport: {
      incidentId: incident.id,
      title: incident.title,
      status: incident.status,
      statusLabel,
      assigneeName: assignee?.displayName ?? null,
      minutesSinceUpdate: minutes,
    },
  };
}

async function handleFindPerson(ctx: ServiceContext, input: SendMessageInput): Promise<Outcome> {
  const people = await discoverPeople(ctx, input.eventId, input.userId, input.text);
  if (people.length === 0) {
    return emptyOutcome(
      'I could not find anyone who has declared that interest and agreed to be discoverable. I only match on declared interests, so nothing is inferred.',
    );
  }
  const top = people.slice(0, 5);
  return {
    ...emptyOutcome(
      `${top.length === 1 ? 'One person' : `${top.length} people`} declared a matching interest. Each match shows the interest that caused it.`,
    ),
    people: top,
  };
}

async function handleConsequential(
  ctx: ServiceContext,
  input: SendMessageInput,
  text: string,
  membership: Membership,
): Promise<{ response: Outcome; linkedApprovalId: string | null }> {
  if (!authorize(membership, 'approval.request', input.eventId).allowed) {
    // Attendees cannot raise approvals. Their request goes to organisers as a triaged item.
    const ingested = await ingestReport(ctx, {
      eventId: input.eventId,
      reporterUserId: input.userId,
      text,
      category: 'GENERAL',
      urgency: 'MEDIUM',
      roomId: null,
      roomName: null,
      equipment: [],
      overcrowded: false,
    });
    return {
      response: {
        ...emptyOutcome(
          `I have passed "${ingested.incident.title}" to the organisers. Changes to the schedule or to announcements need an organiser's decision, and I cannot make them myself.`,
        ),
        incidents: [
          {
            incidentId: ingested.incident.id,
            title: ingested.incident.title,
            category: 'GENERAL',
            status: ingested.incident.status,
            urgency: ingested.incident.urgency,
            attached: ingested.attached,
            matchConfidence: ingested.duplicate?.confidence ?? null,
            matchSignals: ingested.duplicate?.signals ?? [],
            reportId: ingested.reportId,
          },
        ],
      },
      linkedApprovalId: null,
    };
  }

  if (/\bannounce|\bpublish\b/i.test(text)) {
    const payload = { title: text.slice(0, 60), body: text };
    const approval = await requestApproval(ctx, {
      eventId: input.eventId,
      requestedByUserId: input.userId,
      actionType: 'PUBLISH_ANNOUNCEMENT',
      payload,
      justification: 'Announcement proposed from the conversation.',
      linkedIncidentId: null,
    });
    return {
      response: {
        ...emptyOutcome('Announcement sent to organisers for approval. It will not be published until one approves it.'),
        approval: { id: approval.id, actionType: approval.actionType, status: approval.status, level: 'LEVEL_3' },
      },
      linkedApprovalId: approval.id,
    };
  }

  return {
    response: {
      ...emptyOutcome(
        'That changes a published schedule or staffing, which needs an organiser to approve it. Name the session and the target room, and I will send the request.',
      ),
      missingInformation: ['session'],
      clarifyingQuestion: 'Which session, and which room should it move to?',
    },
    linkedApprovalId: null,
  };
}

async function handleQuestion(ctx: ServiceContext, input: SendMessageInput, room: Room | null): Promise<Outcome> {
  if (room) {
    const sessions = (await ctx.store.listSessions(input.eventId)).filter((s) => s.roomId === room.id);
    if (sessions.length === 0) {
      return emptyOutcome(`I have no sessions recorded for ${room.name}.`);
    }
    const lines = sessions
      .sort((a, b) => a.startsAt - b.startsAt)
      .map((s) => `${s.title}, ${formatUtc(s.startsAt)}–${formatUtc(s.endsAt)}`);
    return emptyOutcome(`Sessions in ${room.name}: ${lines.join('; ')}.`);
  }
  return emptyOutcome(
    'I answer from verified event information. Ask about a specific room or session, or describe the problem and I will log it. I will not guess.',
  );
}

