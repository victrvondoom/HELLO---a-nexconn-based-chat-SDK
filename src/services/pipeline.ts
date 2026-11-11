import {
  interpretDeterministically,
  interpretMessage,
  type FallbackReason,
  type Intent,
  type IntentResult,
  type InterpretationSource,
} from '../ai/intent';
import { AgentRun } from '../agents/trace';
import { detectEmergency, EMERGENCY_FALLBACK, EMERGENCY_TERMS } from '../agents/sentinel';
import { ANSWER_THRESHOLD, bestSnippet, hitToReference, searchKnowledge, terms, type KnowledgeHit } from '../agents/knowledge';
import { isOutsideVenueQuestion, redactQuery, searchWeb, type WebOutcome } from '../agents/web';
import type { AgentTrace, Grounding, Reference } from '../agents/types';
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
import { DATA_SOURCE_LABEL } from '../domain/labels';
import { tokenise } from '../domain/incidents/classify';
import { ingestReport, listIncidentsForViewer, recommendAssignees, STATUS_LABEL, ROOM_SCOPED, supplyMissingRoom } from './incidents';
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
  agents: AgentTrace;
  /** The room the message was about, so the reply can offer directions on the venue map. */
  room?: { id: string; name: string } | null;
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
  /** How the agent mesh handled the message, with the sources the reply rests on. */
  agents: AgentTrace;
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
 * The unified conversation pipeline, run as a mesh of small agents (see src/agents/types.ts).
 * Each agent adds facts or sources and records a step in the trace. The model's output only
 * chooses the route. Every state change goes through a domain service with its own checks.
 */
export async function handleMessage(ctx: ServiceContext, input: SendMessageInput): Promise<MessageResponse> {
  const text = input.text.trim();
  if (text.length === 0 || text.length > MAX_MESSAGE_LENGTH) {
    throw new DomainError('VALIDATION_FAILED', `Messages must be between 1 and ${MAX_MESSAGE_LENGTH} characters.`);
  }

  // Identify the user and the active event. Membership is checked on the server.
  const membership = await requireCapability(ctx, input.eventId, input.userId, 'message.send');
  const operational = authorize(membership, 'incident.read.operational', input.eventId).allowed;
  const run = new AgentRun();
  const [rooms, docs, event] = await Promise.all([
    ctx.store.listRooms(input.eventId),
    ctx.store.listReferenceDocs(input.eventId),
    ctx.store.getEvent(input.eventId),
  ]);

  // Triage: what kind of message is this?
  const interpreted = await run.step(
    'triage',
    async () => {
      const value = await interpretMessage(
        { text, roomNames: rooms.map((r) => r.name) },
        { provider: ctx.intentProvider, timeoutMs: ctx.intentTimeoutMs },
      );
      const via = value.source === 'AI_PROVIDER' ? 'AI provider' : 'deterministic rules';
      return { value, summary: `${INTENT_LABEL[value.result.intent]}, via ${via}.`, confidence: value.result.confidence };
    },
    () => ({ result: interpretDeterministically({ text, roomNames: rooms.map((r) => r.name) }), source: 'DETERMINISTIC_FALLBACK' as const, fallbackReason: 'PROVIDER_ERROR' as const }),
  );
  let result: IntentResult = interpreted.result;
  const classification = classifyUtterance(text);

  // Safety sentinel: an emergency is always critical, always reaches operations, and its guidance comes first.
  const danger = detectEmergency(text);
  let safetyLead: string | null = null;
  if (danger.emergency && danger.kind) {
    const kind = danger.kind;
    const page = searchKnowledge(docs, { text: `${EMERGENCY_TERMS[kind]} ${text}`, staff: false, limit: 5 }).find((h) =>
      h.doc.tags.includes('emergency'),
    );
    const ref = page ? hitToReference({ ...page, snippet: bestSnippet(page.doc.body, terms(EMERGENCY_TERMS[kind]), 360) }) : null;
    if (result.intent === 'ASK_QUESTION' || result.intent === 'FIND_PERSON' || result.intent === 'STATUS_CHECK') {
      result = { ...result, intent: 'REPORT_INCIDENT' };
    }
    result = { ...result, urgency: 'CRITICAL' };
    run.record('sentinel', 'DONE', `Possible ${kind.toLowerCase()} emergency (${danger.matched.join(', ')}). Raised to critical.`, 0, 1, ref ? [ref] : []);
    safetyLead = ref ? `${ref.snippet} [${citeIndex(run, ref.id)}]` : EMERGENCY_FALLBACK[kind];
  } else {
    run.record('sentinel', 'DONE', 'No emergency language found.', 0, null);
  }

  // Context: the room, and for questions, whatever the schedule can answer.
  const room = resolveRoomName(text, rooms) ?? (result.roomHint ? resolveRoomName(result.roomHint, rooms) : null);
  const scheduleAnswer = result.intent === 'ASK_QUESTION' ? await answerFromSchedule(ctx, input, room) : null;
  run.record(
    'context',
    'DONE',
    [
      room ? `Room: ${room.name}.` : 'No room named.',
      scheduleAnswer?.reference ? `Schedule record: ${scheduleAnswer.reference.title}.` : null,
    ]
      .filter(Boolean)
      .join(' '),
    0,
    room ? 1 : null,
    scheduleAnswer?.reference ? [scheduleAnswer.reference] : [],
  );

  // Event guide: search the organisers' pages. Staff also see procedures for the category.
  const wantsGuide = result.intent === 'ASK_QUESTION' || result.intent === 'REPORT_INCIDENT' || result.intent === 'REQUEST_ASSISTANCE';
  let guide: KnowledgeHit | null = null;
  if (!wantsGuide) {
    run.record('knowledge', 'SKIPPED', `Not needed for ${INTENT_LABEL[result.intent].toLowerCase()}.`);
  } else {
    const hits = searchKnowledge(docs, { text, staff: operational, category: result.category });
    const top = hits[0];
    guide = top && top.score >= ANSWER_THRESHOLD ? top : null;
    run.record(
      'knowledge',
      'DONE',
      guide
        ? `Best match: “${guide.doc.title}” (relevance ${guide.score.toFixed(2)}).`
        : top
          ? `No page was relevant enough to use (best relevance ${top.score.toFixed(2)}, needs ${ANSWER_THRESHOLD.toFixed(2)}).`
          : `No page in the event guide (${docs.length} pages) matched.`,
      0,
      guide ? guide.score : null,
      guide ? [hitToReference(guide)] : [],
    );
  }

  // Web research: only for questions about the world outside the venue that nothing above answered.
  let web: Extract<WebOutcome, { status: 'OK' }> | null = null;
  if (result.intent !== 'ASK_QUESTION') {
    run.record('web', 'SKIPPED', 'Only questions are researched on the web.');
  } else if (scheduleAnswer?.answered) {
    run.record('web', 'SKIPPED', 'The schedule already answers this.');
  } else if (guide) {
    run.record('web', 'SKIPPED', 'The event guide already answers this.');
  } else if (!isOutsideVenueQuestion(text)) {
    run.record('web', 'SKIPPED', 'The question is about the event, so it is not sent outside HELLO.');
  } else {
    const names = [...(await namesFor(ctx, input.eventId)).values()];
    let query = redactQuery(text, names);
    const city = event?.venueCity ?? null;
    if (city && query.length >= 3 && !query.toLowerCase().includes(city.toLowerCase())) query = `${query} ${city}`;
    const outcome = await run.step(
      'web',
      async () => {
        const value = await searchWeb(ctx.webSearch, query, { timeoutMs: ctx.webSearchTimeoutMs });
        if (value.status === 'OK') {
          return { value, summary: `${value.references.length} sources for “${query}” via ${ctx.webSearch?.name ?? 'provider'}.`, references: value.references };
        }
        return { value, status: value.status, summary: value.reason };
      },
      (): WebOutcome => ({ status: 'FAILED', reason: 'The search failed.' }),
    );
    web = outcome.status === 'OK' ? outcome : null;
  }

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

  let outcome: Omit<MessageResponse, 'messageId' | 'interpretation' | 'room' | 'agents'>;
  let linkedIncidentId: string | null = null;
  let linkedApprovalId: string | null = null;
  let grounding: Grounding = 'VERIFIED_RECORDS';

  // Coordinator: the only agent that changes state, and only through domain services.
  const coordinatorStarted = performance.now();
  switch (result.intent) {
    case 'REPORT_INCIDENT':
    case 'REQUEST_ASSISTANCE':
    case 'SCHEDULE_CONFLICT': {
      const handled = await handleReports(ctx, input, result, classification, room, operational);
      outcome = handled.response;
      linkedIncidentId = handled.linkedIncidentId;
      linkedApprovalId = handled.linkedApprovalId;
      // While the team responds, a public guide page that answers the problem is offered to the reporter.
      if (guide && guide.doc.audience === 'EVERYONE' && !danger.emergency) {
        outcome = { ...outcome, reply: `${outcome.reply} Meanwhile, the event guide says: ${guide.snippet} [${citeIndex(run, guide.doc.id)}]` };
      }
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
    case 'ASK_QUESTION': {
      const follow = room ? await roomFollowUpResponse(ctx, input, room, []) : null;
      if (follow) {
        outcome = follow.response;
        linkedIncidentId = follow.linkedIncidentId;
      } else if (scheduleAnswer?.answered) {
        outcome = scheduleAnswer.outcome;
      } else if (guide) {
        outcome = emptyOutcome(`From the event guide: ${guide.snippet} [${citeIndex(run, guide.doc.id)}]`);
        grounding = 'EVENT_GUIDE';
      } else if (web && web.references[0]) {
        const top = web.references[0];
        outcome = emptyOutcome(
          `The event guide does not cover this. A web source says: “${top.snippet}” [${citeIndex(run, top.id)}] This is from the web and has not been checked by the organisers, so confirm it before relying on it.`,
        );
        grounding = 'WEB_UNVERIFIED';
      } else {
        outcome = emptyOutcome(NO_ANSWER_REPLY);
        grounding = 'NO_ANSWER';
      }
      break;
    }
  }
  run.record('coordinator', 'DONE', describeOutcome(outcome, grounding), performance.now() - coordinatorStarted);

  if (safetyLead) {
    outcome = { ...outcome, reply: `${safetyLead} ${outcome.reply}`.trim() };
  }

  // Grounding check: every reply is labelled with what it rests on.
  run.record('grounding', 'DONE', GROUNDING_SUMMARY[grounding], 0, grounding === 'NO_ANSWER' ? 0 : grounding === 'WEB_UNVERIFIED' ? 0.5 : 1);
  const agents = run.finish(grounding);

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
    agents,
    room: base.room,
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

  return { ...base, ...outcome, agents };
}

const INTENT_LABEL: Record<Intent, string> = {
  REPORT_INCIDENT: 'A problem report',
  REQUEST_ASSISTANCE: 'A request for help',
  STATUS_CHECK: 'A status check',
  SCHEDULE_CONFLICT: 'A schedule conflict',
  FIND_PERSON: 'A request to find people',
  CONSEQUENTIAL_REQUEST: 'A change that needs approval',
  ASK_QUESTION: 'A question',
};

const GROUNDING_SUMMARY: Record<Grounding, string> = {
  VERIFIED_RECORDS: 'Every statement comes from stored incidents, schedule and room records.',
  EVENT_GUIDE: 'The answer quotes the organisers’ event guide and cites the page.',
  WEB_UNVERIFIED: 'The answer quotes a web source. It is labelled as unverified.',
  NO_ANSWER: 'No source answered this, so HELLO says so instead of guessing.',
};

const NO_ANSWER_REPLY =
  'I could not find this in the schedule, the room records or the event guide, so I will not guess. Ask a staff member at registration, or if something is wrong, tell me what is happening and where, and I will log it.';

/** The 1-based position of a reference in the run's citations, used for [n] markers in replies. */
function citeIndex(run: AgentRun, referenceId: string): number {
  return run.citations().findIndex((r) => r.id === referenceId) + 1;
}

function describeOutcome(outcome: Pick<MessageResponse, 'incidents' | 'approval' | 'alternatives' | 'people' | 'statusReport'>, grounding: Grounding): string {
  const parts: string[] = [];
  const joined = outcome.incidents.filter((i) => i.attached).length;
  const opened = outcome.incidents.length - joined;
  if (opened > 0) parts.push(`opened ${opened} incident${opened === 1 ? '' : 's'}`);
  if (joined > 0) parts.push(`joined ${joined} open report${joined === 1 ? '' : 's'}`);
  if (outcome.approval) parts.push('requested an organiser approval');
  if ((outcome.alternatives?.recommendations.length ?? 0) > 0) parts.push(`listed ${outcome.alternatives?.recommendations.length} free sessions`);
  if (outcome.people.length > 0) parts.push(`matched ${outcome.people.length} people by declared interest`);
  if (outcome.statusReport) parts.push('reported the status of your request');
  if (parts.length === 0) {
    return grounding === 'NO_ANSWER' ? 'Nothing to act on, and no source to answer from.' : 'Answered; nothing needed changing.';
  }
  const text = parts.join(', ');
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}.`;
}

type Outcome = Omit<MessageResponse, 'messageId' | 'interpretation' | 'room' | 'agents'>;

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
  return handleReportsInner(ctx, input, result, classification, room, operational);
}

async function handleReportsInner(
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

  // Follow-up: the reporter is answering "which room?" for an earlier report. Continue that report.
  if (room) {
    const concerns = [...wanted].filter((c) => c !== 'GENERAL');
    const follow = await roomFollowUpResponse(ctx, input, room, concerns);
    if (follow) return { response: follow.response, linkedIncidentId: follow.linkedIncidentId, linkedApprovalId: null };
  }

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

/**
 * A message that names a room may be the answer to "which room?" for an earlier report. If the same
 * person has such a report waiting, the answer continues it. A message that states no concern of its
 * own can answer any waiting report; one that states a different concern does not.
 */
async function roomFollowUpResponse(
  ctx: ServiceContext,
  input: SendMessageInput,
  room: Room,
  concerns: readonly IncidentCategory[],
): Promise<{ response: Outcome; linkedIncidentId: string } | null> {
  const compatible: ReadonlySet<IncidentCategory> =
    concerns.length === 0 ? new Set<IncidentCategory>(['AV', 'CAPACITY', 'ACCESSIBILITY', 'FACILITIES', 'SCHEDULE', 'GENERAL']) : new Set(concerns);
  const followUp = await supplyMissingRoom(ctx, {
    eventId: input.eventId,
    reporterUserId: input.userId,
    roomId: room.id,
    roomName: room.name,
    text: input.text.trim(),
    compatibleCategories: compatible,
  });
  if (!followUp) return null;
  return {
    linkedIncidentId: followUp.incident.id,
    response: {
      ...emptyOutcome(`Thanks. I have added ${room.name} to "${followUp.incident.title}", and it is back with the operations team.`),
      incidents: [
        {
          incidentId: followUp.incident.id,
          title: followUp.incident.title,
          category: followUp.incident.category,
          status: followUp.incident.status,
          urgency: followUp.incident.urgency,
          attached: true,
          matchConfidence: 1,
          matchSignals: ['follow-up-room'],
          reportId: followUp.reportId,
        },
      ],
    },
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

interface ScheduleAnswer {
  answered: boolean;
  outcome: Outcome;
  reference: Reference | null;
}

/** Read-only: answers a question about a named session or room from the stored schedule, if it can. */
async function answerFromSchedule(ctx: ServiceContext, input: SendMessageInput, room: Room | null): Promise<ScheduleAnswer> {
  const now = ctx.now();
  const sessions = await ctx.store.listSessions(input.eventId);
  const rooms = await ctx.store.listRooms(input.eventId);
  const roomById = new Map(rooms.map((r) => [r.id, r] as const));
  const asked = new Set(tokenise(input.text).filter((t) => t.length > 2));

  // A named session is answered from its stored record: time, room, seats and whether it has started.
  const matched = sessions
    .map((s) => ({ s, score: tokenise(s.title).filter((t) => t.length > 2 && asked.has(t)).length }))
    .filter((m) => m.score > 0)
    .sort((a, b) => b.score - a.score || a.s.startsAt - b.s.startsAt)[0];
  if (matched && (matched.score >= 2 || tokenise(matched.s.title).filter((t) => t.length > 2).length === 1)) {
    const { s } = matched;
    const r = roomById.get(s.roomId);
    const when =
      s.startsAt > now
        ? `starts in ${Math.round((s.startsAt - now) / 60000)} min`
        : s.endsAt > now
          ? 'is running now'
          : 'has finished';
    const seats = s.capacity - s.enrolled;
    const seatText = seats > 0 ? `${seats} seats free` : 'full';
    const reply = `"${s.title}" ${when}, in ${r?.name ?? 'an unknown room'} at ${formatUtc(s.startsAt)}. It has ${seatText} (${s.enrolled} of ${s.capacity} enrolled).`;
    return {
      answered: true,
      outcome: emptyOutcome(reply),
      reference: { id: `session:${s.id}`, kind: 'SCHEDULE', title: s.title, snippet: `${r?.name ?? 'Unknown room'} · ${formatUtc(s.startsAt)} · ${s.enrolled}/${s.capacity} enrolled`, url: null, score: 1 },
    };
  }

  if (room) {
    const inRoom = sessions.filter((s) => s.roomId === room.id).sort((a, b) => a.startsAt - b.startsAt);
    const occupancy =
      room.occupancy === null || room.occupancySource === null
        ? 'No occupancy figure is recorded for it.'
        : `Recorded occupancy is ${room.occupancy} of ${room.capacity} (${DATA_SOURCE_LABEL[room.occupancySource]}).`;
    const reference: Reference = {
      id: `room:${room.id}`,
      kind: 'SCHEDULE',
      title: room.name,
      snippet: `${room.zone} zone · capacity ${room.capacity}${room.accessible ? ' · step-free' : ''}`,
      url: null,
      score: 1,
    };
    if (inRoom.length === 0) {
      return { answered: true, outcome: emptyOutcome(`${room.name} has no sessions in the schedule. ${occupancy}`), reference };
    }
    const lines = inRoom.map((s) => `${s.title} at ${formatUtc(s.startsAt).slice(11)}`);
    return { answered: true, outcome: emptyOutcome(`${room.name} hosts: ${lines.join('; ')}. ${occupancy}`), reference };
  }

  return {
    answered: false,
    outcome: emptyOutcome(
      'I answer from the schedule, room records and the event guide. Name a session or a room and I will check it. If you are describing a problem, tell me what is happening and where, and I will log it.',
    ),
    reference: null,
  };
}
