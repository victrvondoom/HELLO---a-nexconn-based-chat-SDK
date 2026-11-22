import { DomainError } from '../domain/errors';
import { authorize, type Capability } from '../domain/permissions';
import type { HoldScope, LiveReport, SafetyHold } from '../domain/product';
import { viewVerdict } from '../domain/graph/compile';
import { nodeId, type ContextGraph } from '../domain/graph/types';
import { correlate } from '../domain/live/cluster';
import {
  CLUSTER_WINDOW_MS,
  DUPLICATE_WINDOW_MS,
  LIVE_CATEGORIES,
  holdCovers,
  LIVE_CATEGORY_LABEL,
  MIN_DECISION_REASON,
  cleanReportText,
  expiryFor,
  holdOverdue,
  isLive,
  needsDecision,
  promotionCategoryFor,
  resolutionOf,
  scopeKey,
  validateHoldInput,
  type LiveCategory,
  type ResolutionState,
} from '../domain/live/rules';
import type { Incident, Urgency } from '../domain/types';
import { EMERGENCY_FALLBACK, detectEmergency } from '../agents/sentinel';
import { audit, notify, requireCapability, type ServiceContext } from './context';
import { loadGraph } from './context-graph';
import { ingestReport } from './incidents';

/**
 * LiveScene and LiveShield, as services. Every function re-checks the caller's capability on the server, and
 * every change that another person must be able to see is written as a typed document, so the live bus can
 * nudge the right pages.
 *
 * Holds suspend only the public live layer. They never touch private messages, incidents or other communities.
 */

const liveHref = (eventId: string): string => `/events/${eventId}/live`;

export interface SubmitLiveReportInput {
  eventId: string;
  userId: string;
  spaceId: string;
  category: LiveCategory;
  text: string;
}

export interface SubmitLiveReportResult {
  report: LiveReport;
  /** Shown to the reporter when the words suggest an emergency: the venue's guidance, never a guess. */
  guidance: string | null;
}

export async function submitLiveReport(ctx: ServiceContext, input: SubmitLiveReportInput): Promise<SubmitLiveReportResult> {
  await requireCapability(ctx, input.eventId, input.userId, 'incident.report');
  if (!(LIVE_CATEGORIES as readonly string[]).includes(input.category)) {
    throw new DomainError('VALIDATION_FAILED', 'Choose a kind of report from the list.');
  }
  const text = cleanReportText(input.text);

  const venue = await ctx.store.getVenue(input.eventId);
  const space = venue?.spaces.find((candidate) => candidate.id === input.spaceId);
  if (!space) throw new DomainError('NOT_FOUND', 'That place is not on the venue map.');
  const room = space.roomId ? await ctx.store.getRoom(space.roomId) : null;
  const zone = room?.zone ?? space.name;

  const now = ctx.now();
  const mine = await ctx.store.docList('liveReports', { eventId: input.eventId, reporterUserId: input.userId });
  if (mine.some((earlier) => earlier.text === text && earlier.spaceId === space.id && now - earlier.createdAt <= DUPLICATE_WINDOW_MS)) {
    throw new DomainError('DUPLICATE', 'You have just sent this report for this place.');
  }

  const signal = detectEmergency(text);
  const safetySignal = signal.emergency ? signal.kind : null;
  const report: LiveReport = {
    id: ctx.newId('lrp'),
    eventId: input.eventId,
    reporterUserId: input.userId,
    category: input.category,
    spaceId: space.id,
    zone,
    text,
    safetySignal,
    status: 'OPEN',
    incidentId: null,
    createdAt: now,
    expiresAt: expiryFor(input.category, now),
    decisionByUserId: null,
    decidedAt: null,
    decisionReason: null,
    version: 1,
  };
  await ctx.store.docPut('liveReports', report);
  await audit(ctx, input.eventId, input.userId, 'live.reported', 'live_report', report.id, `${input.category} at ${zone}`);

  if (input.category === 'SAFETY' || safetySignal) {
    await notifyReviewers(ctx, input.eventId, input.userId, `${LIVE_CATEGORY_LABEL[input.category]} report at ${zone} needs review.`, 'LIVE_REPORT', report.id);
  }
  return { report, guidance: safetySignal ? EMERGENCY_FALLBACK[safetySignal] : null };
}

export interface LiveFeedItem {
  id: string;
  category: LiveCategory;
  categoryLabel: string;
  zone: string;
  spaceId: string;
  spaceName: string;
  reportedAt: number;
  expiresAt: number;
  resolution: ResolutionState;
  /** How many live reports are grouped with this one by place, zone, category and time. An inferred grouping. */
  clusterSize: number;
  mine: boolean;
  /** The reporter's own report, while a hold suspends it. The reporter is told it is under review. */
  underReview: boolean;
  /** Text and identity are shown to staff and to the reporter only. */
  text: string | null;
  reporterName: string | null;
  safetySignal: LiveReport['safetySignal'];
  incidentId: string | null;
  decisionReason: string | null;
}

export interface LiveHoldView {
  id: string;
  scope: HoldScope;
  scopeLabel: string;
  reason: string;
  placedByName: string;
  placedAt: number;
  decisionDueAt: number;
  overdue: boolean;
  /** The viewer holds the release capability and did not place this hold. */
  canRelease: boolean;
}

export interface LiveFeed {
  viewer: 'STAFF' | 'ATTENDEE';
  /** HOLDS_UNAVAILABLE: hold records could not be read. Attendees then see only their own reports. */
  state: 'OK' | 'HOLDS_UNAVAILABLE';
  now: number;
  reports: LiveFeedItem[];
  /** Staff only: safety-flagged reports that still need a decision, including those that have expired. */
  queue: LiveFeedItem[];
  holds: LiveHoldView[];
}

export async function liveFeed(ctx: ServiceContext, eventId: string, userId: string): Promise<LiveFeed> {
  const membership = await ctx.store.findMembership(eventId, userId);
  if (!membership || !authorize(membership, 'event.read', eventId).allowed) {
    throw new DomainError('FORBIDDEN', 'You are not a member of this event.');
  }
  const staff = authorize(membership, 'live.review', eventId).allowed;
  const canRelease = authorize(membership, 'safety.release', eventId).allowed;
  const now = ctx.now();
  const viewer = { userId, staff };

  const graph = await loadGraph(ctx, eventId);
  const records = await ctx.store.docList('liveReports', { eventId });
  const incidents = await ctx.store.listIncidents(eventId);
  const incidentById = new Map<string, Incident>(incidents.map((incident) => [incident.id, incident]));

  // Visibility comes from the Context Compiler's rule, so the feed and the snapshots always agree.
  const visibleLive: LiveReport[] = [];
  for (const record of records) {
    const node = graph.nodes.get(nodeId.report(record.id));
    if (!node) continue;
    if (viewVerdict(graph, node, viewer, now).kind !== 'VISIBLE') continue;
    if (!isLive(record, now)) continue;
    visibleLive.push(record);
  }
  // Clusters are formed from what this viewer may see, so a hidden report cannot change a visible count.
  const clusterOf = clusterSizes(visibleLive);

  const reports = visibleLive
    .sort((a, b) => b.createdAt - a.createdAt || (a.id < b.id ? -1 : 1))
    .map((record) => itemFor(graph, record, incidentById, clusterOf, viewer));

  const queue = staff
    ? records
        .filter((record) => needsDecision(record))
        .sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1))
        .map((record) => itemFor(graph, record, incidentById, new Map(), viewer))
    : [];

  const holds: LiveHoldView[] = staff
    ? graph.holds
        .filter((hold) => hold.status === 'IN_FORCE')
        .map((hold) => holdView(graph, hold, userId, canRelease, now))
        .sort((a, b) => a.placedAt - b.placedAt)
    : [];

  return {
    viewer: staff ? 'STAFF' : 'ATTENDEE',
    state: graph.holdsAvailable ? 'OK' : 'HOLDS_UNAVAILABLE',
    now,
    reports,
    queue,
    holds,
  };
}

function clusterSizes(reports: readonly LiveReport[]): Map<string, number> {
  const sizes = new Map<string, number>();
  for (const cluster of correlate(reports, CLUSTER_WINDOW_MS)) {
    for (const member of cluster) sizes.set(member.id, cluster.length);
  }
  return sizes;
}

function itemFor(
  graph: ContextGraph,
  record: LiveReport,
  incidentById: ReadonlyMap<string, Incident>,
  clusterOf: ReadonlyMap<string, number>,
  viewer: { userId: string; staff: boolean },
): LiveFeedItem {
  const own = record.reporterUserId === viewer.userId;
  const incident = record.incidentId ? (incidentById.get(record.incidentId) ?? null) : null;
  const underReview = own && !viewer.staff && graph.holds.some((hold) => holdCovers(hold, record));
  const reporter = graph.nodes.get(nodeId.person(record.reporterUserId));
  return {
    id: record.id,
    category: record.category,
    categoryLabel: LIVE_CATEGORY_LABEL[record.category],
    zone: record.zone,
    spaceId: record.spaceId,
    spaceName: graph.nodes.get(nodeId.space(record.spaceId))?.label ?? record.zone,
    reportedAt: record.createdAt,
    expiresAt: record.expiresAt,
    resolution: resolutionOf(record, incident),
    clusterSize: clusterOf.get(record.id) ?? 1,
    mine: own,
    underReview,
    text: viewer.staff || own ? record.text : null,
    reporterName: viewer.staff ? (reporter?.label ?? null) : null,
    safetySignal: viewer.staff || own ? record.safetySignal : null,
    incidentId: viewer.staff || own ? record.incidentId : null,
    decisionReason: viewer.staff ? record.decisionReason : null,
  };
}

function holdView(graph: ContextGraph, hold: ContextGraph['holds'][number], userId: string, canRelease: boolean, now: number): LiveHoldView {
  const placer = graph.nodes.get(nodeId.person(hold.placedByUserId))?.label ?? 'a staff member';
  return {
    id: hold.id,
    scope: hold.scope,
    scopeLabel: hold.scope.kind === 'EVENT' ? 'Whole event' : hold.scope.kind === 'ZONE' ? `Zone: ${hold.scope.zone}` : 'One report',
    reason: hold.reason,
    placedByName: placer,
    placedAt: hold.placedAt,
    decisionDueAt: hold.decisionDueAt,
    overdue: holdOverdue(hold, now),
    canRelease: canRelease && hold.placedByUserId !== userId,
  };
}

export async function promoteLiveReport(
  ctx: ServiceContext,
  input: { eventId: string; actorUserId: string; reportId: string; category: LiveCategory },
): Promise<{ incident: Incident; attached: boolean; alreadyPromoted: boolean }> {
  await requireCapability(ctx, input.eventId, input.actorUserId, 'live.review');
  const current = await ctx.store.docGet('liveReports', input.reportId);
  if (!current || current.eventId !== input.eventId) throw new DomainError('NOT_FOUND', 'Report not found.');

  const incidentCategory = promotionCategoryFor(input.category);
  if (!incidentCategory) {
    throw new DomainError('VALIDATION_FAILED', 'That kind of report is not promoted to an incident. Dismiss it, or leave it live until it expires.');
  }

  const promotedIncident = async (record: LiveReport) => {
    if (record.status !== 'PROMOTED' || !record.incidentId) return null;
    const incident = await ctx.store.getIncident(record.incidentId);
    return incident ? { incident, attached: true, alreadyPromoted: true } : null;
  };
  const existing = await promotedIncident(current);
  if (existing) return existing;

  // Claim first: exactly one caller can move the report from OPEN to PROMOTING, so two staff members can never
  // open two incidents for one report.
  const claimed = await ctx.store.docMutate('liveReports', input.reportId, (record) =>
    record.status === 'OPEN' && record.eventId === input.eventId ? { ...record, status: 'PROMOTING', version: record.version + 1 } : null,
  );
  if (!claimed) {
    const latest = await ctx.store.docGet('liveReports', input.reportId);
    const done = latest ? await promotedIncident(latest) : null;
    if (done) return done;
    throw new DomainError('ALREADY_HANDLED', 'Someone has already promoted or dismissed this report. Refresh to see the latest.');
  }

  const venue = await ctx.store.getVenue(input.eventId);
  const space = venue?.spaces.find((candidate) => candidate.id === claimed.spaceId);
  const room = space?.roomId ? await ctx.store.getRoom(space.roomId) : null;
  const urgency: Urgency = claimed.safetySignal ? 'HIGH' : 'MEDIUM';

  let result: Awaited<ReturnType<typeof ingestReport>>;
  try {
    result = await ingestReport(ctx, {
      eventId: input.eventId,
      reporterUserId: claimed.reporterUserId,
      text: claimed.text,
      category: incidentCategory,
      urgency,
      roomId: space?.roomId ?? null,
      roomName: room?.name ?? null,
      equipment: [],
      overcrowded: false,
    });
  } catch (error: unknown) {
    // Give the report back so it can be tried again. Nothing was marked promoted.
    await ctx.store.docMutate('liveReports', input.reportId, (record) =>
      record.status === 'PROMOTING' ? { ...record, status: 'OPEN', version: record.version + 1 } : null,
    );
    throw error;
  }

  await ctx.store.docMutate('liveReports', input.reportId, (record) => ({
    ...record,
    status: 'PROMOTED',
    incidentId: result.incident.id,
    decisionByUserId: input.actorUserId,
    decidedAt: ctx.now(),
    decisionReason: result.attached ? 'Attached to an existing incident.' : 'Opened as an incident.',
    version: record.version + 1,
  }));
  await audit(ctx, input.eventId, input.actorUserId, 'live.promoted', 'live_report', input.reportId, `Incident ${result.incident.id}`);
  return { incident: result.incident, attached: result.attached, alreadyPromoted: false };
}

export async function dismissLiveReport(ctx: ServiceContext, input: { eventId: string; actorUserId: string; reportId: string; reason: string }): Promise<LiveReport> {
  await requireCapability(ctx, input.eventId, input.actorUserId, 'live.review');
  const reason = input.reason.trim();
  if (reason.length < MIN_DECISION_REASON) {
    throw new DomainError('VALIDATION_FAILED', `Give the reason in at least ${MIN_DECISION_REASON} characters.`);
  }
  const now = ctx.now();
  const updated = await ctx.store.docMutate('liveReports', input.reportId, (record) =>
    record.eventId === input.eventId && record.status === 'OPEN'
      ? { ...record, status: 'DISMISSED', decisionByUserId: input.actorUserId, decidedAt: now, decisionReason: reason, version: record.version + 1 }
      : null,
  );
  if (!updated) {
    const exists = await ctx.store.docGet('liveReports', input.reportId);
    if (!exists || exists.eventId !== input.eventId) throw new DomainError('NOT_FOUND', 'Report not found.');
    throw new DomainError('ALREADY_HANDLED', 'This report has already been promoted or dismissed.');
  }
  await audit(ctx, input.eventId, input.actorUserId, 'live.dismissed', 'live_report', input.reportId, reason);
  return updated;
}

export type HoldScopeInput = { kind: 'EVENT' } | { kind: 'ZONE'; zone: string } | { kind: 'REPORT'; reportId: string };

/**
 * Places a scoped hold. Holds are time-bounded: a decision due time is required. A whole-event hold needs the
 * stronger capability. Placing the same hold twice returns the one already in force.
 */
export async function placeSafetyHold(
  ctx: ServiceContext,
  input: { eventId: string; actorUserId: string; scope: HoldScopeInput; reason: string; durationMinutes: number },
): Promise<{ hold: SafetyHold; created: boolean }> {
  await requireCapability(ctx, input.eventId, input.actorUserId, 'safety.hold');
  if (input.scope.kind === 'EVENT') await requireCapability(ctx, input.eventId, input.actorUserId, 'safety.hold.event');
  const reason = validateHoldInput(input.reason, input.durationMinutes);

  let scope: HoldScope;
  if (input.scope.kind === 'ZONE') {
    const zones = await knownZones(ctx, input.eventId);
    if (!zones.has(input.scope.zone)) throw new DomainError('NOT_FOUND', 'That zone is not on the venue map.');
    scope = { kind: 'ZONE', zone: input.scope.zone };
  } else if (input.scope.kind === 'REPORT') {
    const target = await ctx.store.docGet('liveReports', input.scope.reportId);
    if (!target || target.eventId !== input.eventId) throw new DomainError('NOT_FOUND', 'Report not found.');
    scope = { kind: 'REPORT', reportId: input.scope.reportId };
  } else {
    scope = { kind: 'EVENT' };
  }

  const now = ctx.now();
  // One hold document per scope per event. Its id comes from the scope, so two simultaneous placements cannot
  // create two holds for the same scope.
  const id = `hold:${input.eventId}:${scopeKey(scope)}`;
  const fresh: SafetyHold = {
    id,
    eventId: input.eventId,
    scope,
    reason,
    placedByUserId: input.actorUserId,
    placedAt: now,
    decisionDueAt: now + input.durationMinutes * 60 * 1000,
    status: 'IN_FORCE',
    releasedByUserId: null,
    releasedAt: null,
    releaseReason: null,
    version: 1,
  };

  if (await ctx.store.docPutIfAbsent('safetyHolds', fresh)) {
    await announcePlaced(ctx, fresh);
    return { hold: fresh, created: true };
  }
  const reactivated = await ctx.store.docMutate('safetyHolds', id, (hold) => (hold.status === 'RELEASED' ? { ...fresh, version: hold.version + 1 } : null));
  if (reactivated) {
    await announcePlaced(ctx, reactivated);
    return { hold: reactivated, created: true };
  }
  const current = await ctx.store.docGet('safetyHolds', id);
  if (!current) throw new DomainError('NOT_FOUND', 'Hold not found.');
  return { hold: current, created: false };
}

async function announcePlaced(ctx: ServiceContext, hold: SafetyHold): Promise<void> {
  const what = hold.scope.kind === 'EVENT' ? 'the whole event' : hold.scope.kind === 'ZONE' ? `zone ${hold.scope.zone}` : 'one report';
  await audit(ctx, hold.eventId, hold.placedByUserId, 'safety.hold_placed', 'safety_hold', hold.id, `${what}: ${hold.reason}`);
  await notifyReviewers(
    ctx,
    hold.eventId,
    hold.placedByUserId,
    `A safety hold on ${what} is in force. It needs a decision by ${new Date(hold.decisionDueAt).toISOString()}.`,
    'SAFETY_HOLD',
    hold.id,
  );
}

/**
 * Releases a hold. This is the only way visibility is restored. The releaser must hold `safety.release` and must
 * not be the person who placed the hold. The rule is checked again inside the compare-and-set.
 */
export async function releaseSafetyHold(ctx: ServiceContext, input: { eventId: string; actorUserId: string; holdId: string; reason: string }): Promise<SafetyHold> {
  await requireCapability(ctx, input.eventId, input.actorUserId, 'safety.release');
  const reason = input.reason.trim();
  if (reason.length < MIN_DECISION_REASON) {
    throw new DomainError('VALIDATION_FAILED', `Give the reason in at least ${MIN_DECISION_REASON} characters.`);
  }
  const current = await ctx.store.docGet('safetyHolds', input.holdId);
  if (!current || current.eventId !== input.eventId) throw new DomainError('NOT_FOUND', 'Hold not found.');
  if (current.status !== 'IN_FORCE') throw new DomainError('ALREADY_HANDLED', 'That hold has already been released.');
  if (current.placedByUserId === input.actorUserId) {
    throw new DomainError('FORBIDDEN', 'A different organiser must release a hold. The person who placed it cannot release it.');
  }
  const now = ctx.now();
  const released = await ctx.store.docMutate('safetyHolds', input.holdId, (hold) =>
    hold.status === 'IN_FORCE' && hold.placedByUserId !== input.actorUserId
      ? { ...hold, status: 'RELEASED', releasedByUserId: input.actorUserId, releasedAt: now, releaseReason: reason, version: hold.version + 1 }
      : null,
  );
  if (!released) throw new DomainError('ALREADY_HANDLED', 'That hold has already been released.');
  await audit(ctx, input.eventId, input.actorUserId, 'safety.hold_released', 'safety_hold', input.holdId, reason);
  await notifyReviewers(ctx, input.eventId, input.actorUserId, 'A safety hold was released. The live view is shown again for its scope.', 'SAFETY_HOLD', `${input.holdId}:released`);
  return released;
}

async function knownZones(ctx: ServiceContext, eventId: string): Promise<Set<string>> {
  const zones = new Set<string>();
  const venue = await ctx.store.getVenue(eventId);
  for (const room of await ctx.store.listRooms(eventId)) zones.add(room.zone);
  for (const space of venue?.spaces ?? []) {
    if (!space.roomId) zones.add(space.name);
  }
  return zones;
}

/** Tells the people who can review live reports. Bodies carry no reporter identity and no report text. */
async function notifyReviewers(ctx: ServiceContext, eventId: string, actorUserId: string, body: string, kind: string, subjectId: string): Promise<void> {
  const capability: Capability = 'live.review';
  const memberships = await ctx.store.listMemberships(eventId);
  for (const membership of memberships) {
    if (membership.userId === actorUserId) continue;
    if (!authorize(membership, capability, eventId).allowed) continue;
    await notify(ctx, {
      eventId,
      recipientUserId: membership.userId,
      kind,
      body,
      href: liveHref(eventId),
      dedupeParts: [subjectId],
    });
  }
}
