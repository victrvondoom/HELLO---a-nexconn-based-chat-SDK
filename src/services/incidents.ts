import { DomainError } from '../domain/errors';
import { authorize } from '../domain/permissions';
import { allowedNextStatuses, assertTransition, canTransition, type TransitionActor, isOpen } from '../domain/incidents/lifecycle';
import { findDuplicate, type DuplicateAssessment, type CandidateContext } from '../domain/incidents/duplicates';
import { rankAssignees, type AssignmentScore } from '../domain/assignments/scoring';
import { STAFF_ROLES, type Incident, type IncidentCategory, type IncidentReport, type IncidentStatus, type IncidentTimelineEntry, type Membership, type Urgency } from '../domain/types';
import { VersionConflictError } from '../store/store';
import { audit, notify, requireCapability, type ServiceContext } from './context';

import { STATUS_LABEL } from '../domain/labels';
export { STATUS_LABEL };

export const ROOM_SCOPED: ReadonlySet<IncidentCategory> = new Set<IncidentCategory>([
  'AV',
  'CAPACITY',
  'ACCESSIBILITY',
  'FACILITIES',
]);

export function incidentHref(eventId: string, incidentId: string): string {
  return `/events/${eventId}/incidents/${incidentId}`;
}

/** Determines which transition actor kinds the caller has for this incident. */
export async function actorKindsFor(
  ctx: ServiceContext,
  membership: Membership,
  incident: Incident,
): Promise<TransitionActor[]> {
  const kinds: TransitionActor[] = [];
  if (incident.assigneeUserId === membership.userId) {
    kinds.push('ASSIGNEE');
  }
  if (STAFF_ROLES.includes(membership.role)) {
    kinds.push('STAFF');
  }
  if (membership.role === 'OPERATIONS_STAFF' || membership.role === 'ORGANISER') {
    kinds.push('OPERATIONS');
  }
  const reporters = await reporterIds(ctx, incident);
  if (reporters.has(membership.userId)) {
    kinds.push('REPORTER');
  }
  return kinds;
}

async function reporterIds(ctx: ServiceContext, incident: Incident): Promise<Set<string>> {
  const reports = await ctx.store.listReportsForIncident(incident.id);
  return new Set<string>([incident.createdByUserId, ...reports.map((r) => r.reporterUserId)]);
}

export interface IncidentDetail {
  incident: Incident;
  reports: IncidentReport[];
  timeline: IncidentTimelineEntry[];
  assigneeName: string | null;
  viewerCanOperate: boolean;
  viewerIsReporter: boolean;
  allowedNextStatuses: IncidentStatus[];
  recommendations: AssignmentScore[];
}

/** Loads an incident for a viewer. Attendees see only incidents they reported; staff see the operational view. */
export async function getIncidentDetail(
  ctx: ServiceContext,
  eventId: string,
  userId: string,
  incidentId: string,
): Promise<IncidentDetail> {
  const membership = await ctx.store.findMembership(eventId, userId);
  if (!membership) {
    throw new DomainError('FORBIDDEN', 'You are not a member of this event.');
  }
  const incident = await ctx.store.getIncident(incidentId);
  if (!incident || incident.eventId !== eventId) {
    throw new DomainError('NOT_FOUND', 'Incident not found.');
  }

  const operational = authorize(membership, 'incident.read.operational', eventId).allowed;
  const reporters = await reporterIds(ctx, incident);
  const isReporter = reporters.has(userId);
  if (!operational && !isReporter) {
    throw new DomainError('NOT_FOUND', 'Incident not found.');
  }

  const reports = await ctx.store.listReportsForIncident(incidentId);
  const timeline = await ctx.store.listTimeline(incidentId);
  const memberships = await ctx.store.listMemberships(eventId);
  const names = await nameMap(ctx, memberships.map((m) => m.userId));
  const assigneeName = incident.assigneeUserId ? (names.get(incident.assigneeUserId) ?? null) : null;

  let recommendations: AssignmentScore[] = [];
  if (operational && (incident.status === 'TRIAGED' || incident.status === 'ESCALATED')) {
    recommendations = await recommendAssignees(ctx, incident, memberships, names);
  }

  // Only the transitions this viewer could actually perform are offered in the UI.
  const actors = await actorKindsFor(ctx, membership, incident);
  const nextStatuses = allowedNextStatuses(incident.status).filter((to) =>
    canTransition(incident.status, to, actors),
  );

  return {
    incident,
    reports,
    timeline,
    assigneeName,
    viewerCanOperate: operational,
    viewerIsReporter: isReporter,
    allowedNextStatuses: nextStatuses,
    recommendations,
  };
}

async function nameMap(ctx: ServiceContext, userIds: readonly string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  for (const id of new Set(userIds)) {
    const user = await ctx.store.getUser(id);
    if (user) {
      map.set(id, user.displayName);
    }
  }
  return map;
}

export async function recommendAssignees(
  ctx: ServiceContext,
  incident: Incident,
  memberships: readonly Membership[],
  names: Map<string, string>,
): Promise<AssignmentScore[]> {
  const openCounts = await ctx.store.countOpenAssignments(incident.eventId);
  const room = incident.roomId ? await ctx.store.getRoom(incident.roomId) : null;
  const ranking = rankAssignees(
    { category: incident.category, zone: room?.zone ?? null },
    memberships.map((m) => ({
      membership: m,
      displayName: names.get(m.userId) ?? m.userId,
      openAssignments: openCounts.get(m.userId) ?? 0,
    })),
  );
  return ranking.eligible.slice(0, 3);
}

/**
 * Claims an incident for the caller. The claim is a compare-and-set on `version`,
 * so when two staff members press "Claim" at the same moment exactly one succeeds
 * and the other receives ALREADY_CLAIMED.
 */
export async function claimIncident(
  ctx: ServiceContext,
  eventId: string,
  actorUserId: string,
  incidentId: string,
  expectedVersion: number,
): Promise<Incident> {
  const membership = await requireCapability(ctx, eventId, actorUserId, 'incident.claim');
  const incident = await loadIncidentInEvent(ctx, eventId, incidentId);

  if (incident.assigneeUserId !== null && incident.assigneeUserId !== actorUserId) {
    throw new DomainError('ALREADY_CLAIMED', 'Another staff member has already claimed this incident.');
  }
  if (incident.version !== expectedVersion) {
    throw new VersionConflictError('incident');
  }
  assertTransition(incident.status, 'ASSIGNED', ['STAFF']);

  const names = await nameMap(ctx, [actorUserId]);
  const openCounts = await ctx.store.countOpenAssignments(eventId);
  const room = incident.roomId ? await ctx.store.getRoom(incident.roomId) : null;
  const ranking = rankAssignees(
    { category: incident.category, zone: room?.zone ?? null },
    [
      {
        membership,
        displayName: names.get(actorUserId) ?? actorUserId,
        openAssignments: openCounts.get(actorUserId) ?? 0,
      },
    ],
  );
  if (ranking.eligible.length === 0) {
    const reason = ranking.ineligible[0]?.reason ?? 'You are not eligible for this incident.';
    throw new DomainError('INELIGIBLE', reason);
  }

  let updated: Incident;
  try {
    updated = await ctx.store.updateIncident(
      incidentId,
      expectedVersion,
      { status: 'ASSIGNED', assigneeUserId: actorUserId },
      ctx.now(),
    );
  } catch (error: unknown) {
    if (error instanceof VersionConflictError) {
      const latest = await ctx.store.getIncident(incidentId);
      if (latest?.assigneeUserId) {
        throw new DomainError('ALREADY_CLAIMED', 'Another staff member has already claimed this incident.');
      }
    }
    throw error;
  }

  await ctx.store.appendTimeline({
    id: ctx.newId('tl'),
    incidentId,
    eventId,
    type: 'ASSIGNED',
    actorUserId,
    fromStatus: incident.status,
    toStatus: 'ASSIGNED',
    detail: `Claimed by ${names.get(actorUserId) ?? actorUserId}.`,
    at: ctx.now(),
  });
  await audit(ctx, eventId, actorUserId, 'incident.claimed', 'incident', incidentId, 'Claimed assignment.');
  await notifyReporters(ctx, updated, actorUserId, 'Someone is now handling your report.');
  return updated;
}

async function loadIncidentInEvent(ctx: ServiceContext, eventId: string, incidentId: string): Promise<Incident> {
  const incident = await ctx.store.getIncident(incidentId);
  if (!incident || incident.eventId !== eventId) {
    throw new DomainError('NOT_FOUND', 'Incident not found.');
  }
  return incident;
}

export interface TransitionInput {
  eventId: string;
  actorUserId: string;
  incidentId: string;
  to: IncidentStatus;
  expectedVersion: number;
  resolutionNote?: string;
}

/**
 * Moves an incident to a new status. Legal moves come from the lifecycle table; the
 * caller's relationship to the incident (assignee, reporter, staff) decides which of them are allowed.
 */
export async function transitionIncident(ctx: ServiceContext, input: TransitionInput): Promise<Incident> {
  const membership = await ctx.store.findMembership(input.eventId, input.actorUserId);
  if (!membership) {
    throw new DomainError('FORBIDDEN', 'You are not a member of this event.');
  }
  const incident = await loadIncidentInEvent(ctx, input.eventId, input.incidentId);
  if (incident.version !== input.expectedVersion) {
    throw new VersionConflictError('incident');
  }

  const actors = await actorKindsFor(ctx, membership, incident);
  assertTransition(incident.status, input.to, actors);

  if (input.to === 'RESOLVED' && (!input.resolutionNote || input.resolutionNote.trim().length < 5)) {
    throw new DomainError('VALIDATION_FAILED', 'Describe what was done before marking the incident resolved.');
  }

  const now = ctx.now();
  const patch: Partial<Incident> = { status: input.to };
  if (input.to === 'ACKNOWLEDGED') patch.acknowledgedAt = now;
  if (input.to === 'RESOLVED') {
    patch.resolvedAt = now;
    patch.resolutionNote = (input.resolutionNote ?? '').trim();
  }
  if (input.to === 'CONFIRMED') patch.confirmedAt = now;

  const updated = await writeStatus(ctx, incident, patch, input.actorUserId, input.to, now);

  // Confirmation by the reporter closes the loop. Closing is a system step that must follow a confirmation.
  if (input.to === 'CONFIRMED') {
    assertTransition('CONFIRMED', 'CLOSED', ['SYSTEM']);
    return writeStatus(ctx, updated, { status: 'CLOSED' }, null, 'CLOSED', ctx.now());
  }
  return updated;
}

async function writeStatus(
  ctx: ServiceContext,
  incident: Incident,
  patch: Partial<Incident>,
  actorUserId: string | null,
  to: IncidentStatus,
  now: number,
): Promise<Incident> {
  const updated = await ctx.store.updateIncident(incident.id, incident.version, patch, now);
  await ctx.store.appendTimeline({
    id: ctx.newId('tl'),
    incidentId: incident.id,
    eventId: incident.eventId,
    type: 'STATUS_CHANGED',
    actorUserId,
    fromStatus: incident.status,
    toStatus: to,
    detail: `Status changed from ${incident.status} to ${to}.`,
    at: now,
  });
  await audit(ctx, incident.eventId, actorUserId, 'incident.status_changed', 'incident', incident.id, `${incident.status} -> ${to}`);

  await notifyForStatus(ctx, updated, actorUserId, to);
  return updated;
}

/** Notifications are sent only after the status change has been written. */
async function notifyForStatus(
  ctx: ServiceContext,
  incident: Incident,
  actorUserId: string | null,
  to: IncidentStatus,
): Promise<void> {
  if (to === 'RESOLVED') {
    await notifyReporters(
      ctx,
      incident,
      actorUserId,
      'The team has marked your report as resolved. Please confirm, or reopen it if the problem continues.',
      'RESOLUTION_CONFIRMATION_REQUEST',
    );
    return;
  }
  if (to === 'CLOSED') {
    await notifyReporters(ctx, incident, actorUserId, 'Thank you. This report is now closed.');
    return;
  }
  if (to === 'ESCALATED') {
    await notifyOperations(ctx, incident, actorUserId, `Escalated: ${incident.title}`);
    return;
  }
  if (to === 'IN_PROGRESS' || to === 'ACKNOWLEDGED' || to === 'NEEDS_INFORMATION' || to === 'REOPENED' || to === 'CANCELLED') {
    await notifyReporters(ctx, incident, actorUserId, `${incident.title}: ${STATUS_LABEL[to]}.`);
  }
}

async function notifyReporters(
  ctx: ServiceContext,
  incident: Incident,
  actorUserId: string | null,
  body: string,
  kind = 'INCIDENT_UPDATE',
): Promise<void> {
  const reporters = await reporterIds(ctx, incident);
  for (const recipient of reporters) {
    if (recipient === actorUserId) continue;
    await notify(ctx, {
      eventId: incident.eventId,
      recipientUserId: recipient,
      kind,
      body,
      href: incidentHref(incident.eventId, incident.id),
      dedupeParts: [incident.id, incident.status, incident.version],
    });
  }
}

async function notifyOperations(
  ctx: ServiceContext,
  incident: Incident,
  actorUserId: string | null,
  body: string,
): Promise<void> {
  const memberships = await ctx.store.listMemberships(incident.eventId);
  for (const m of memberships) {
    if (m.userId === actorUserId) continue;
    if (!authorize(m, 'incident.read.operational', incident.eventId).allowed) continue;
    await notify(ctx, {
      eventId: incident.eventId,
      recipientUserId: m.userId,
      kind: 'OPERATIONS_ALERT',
      body,
      href: incidentHref(incident.eventId, incident.id),
      dedupeParts: [incident.id, incident.status, incident.version],
    });
  }
}

export interface IngestInput {
  eventId: string;
  reporterUserId: string;
  text: string;
  category: IncidentCategory;
  urgency: Urgency;
  roomId: string | null;
  roomName: string | null;
  equipment: string[];
  /** Set when a sensor/admin fact already justifies escalation. Never set from AI output alone. */
  overcrowded: boolean;
}

export interface IngestResult {
  incident: Incident;
  attached: boolean;
  duplicate: DuplicateAssessment | null;
  reportId: string;
}

/**
 * Records a report. Either attaches it to an existing open incident (when every
 * duplicate gate passes) or opens a new incident. Either way the reporter's own record is kept.
 */
export async function ingestReport(ctx: ServiceContext, input: IngestInput): Promise<IngestResult> {
  const now = ctx.now();
  const incidents = await ctx.store.listIncidents(input.eventId);
  const reports = await ctx.store.listReportsForEvent(input.eventId);
  const candidates: CandidateContext[] = incidents
    .filter((i) => isOpen(i.status))
    .map((incident) => ({ incident, reports: reports.filter((r) => r.incidentId === incident.id) }));

  const duplicate = findDuplicate(
    {
      eventId: input.eventId,
      roomId: input.roomId,
      category: input.category,
      equipment: input.equipment,
      text: input.text,
      at: now,
    },
    candidates,
    now,
  );

  if (duplicate) {
    const existing = await ctx.store.getIncident(duplicate.incidentId);
    if (!existing) {
      throw new DomainError('NOT_FOUND', 'Matched incident disappeared.');
    }
    const reportId = ctx.newId('rpt');
    await ctx.store.insertReport({
      id: reportId,
      incidentId: existing.id,
      eventId: input.eventId,
      reporterUserId: input.reporterUserId,
      text: input.text,
      createdAt: now,
      matchConfidence: duplicate.confidence,
      matchSignals: duplicate.signals,
    });
    const mergedEquipment = [...new Set([...existing.equipment, ...input.equipment])];
    const reportCount = reports.filter((r) => r.incidentId === existing.id).length + 1;
    const updated = await ctx.store.updateIncident(existing.id, existing.version, { equipment: mergedEquipment }, now);
    await ctx.store.appendTimeline({
      id: ctx.newId('tl'),
      incidentId: existing.id,
      eventId: input.eventId,
      type: 'REPORT_ATTACHED',
      actorUserId: input.reporterUserId,
      fromStatus: null,
      toStatus: null,
      detail: `Another report attached (match confidence ${duplicate.confidence.toFixed(2)}; ${duplicate.signals.join(', ')}). ${reportCount} reports in total.`,
      at: now,
    });
    await audit(ctx, input.eventId, input.reporterUserId, 'incident.report_attached', 'incident', existing.id, `Report ${reportId} attached.`);
    await notifyOperations(ctx, updated, input.reporterUserId, `${reportCount} people have now reported: ${existing.title}`);
    return { incident: updated, attached: true, duplicate, reportId };
  }

  const needsRoom = ROOM_SCOPED.has(input.category) && input.roomId === null;
  const incidentId = ctx.newId('inc');
  const title = buildTitle(input.category, input.roomName, input.equipment);
  const base: Incident = {
    id: incidentId,
    eventId: input.eventId,
    category: input.category,
    status: needsRoom ? 'NEEDS_INFORMATION' : 'REPORTED',
    urgency: input.overcrowded ? 'HIGH' : input.urgency,
    title,
    roomId: input.roomId,
    sessionId: null,
    equipment: input.equipment,
    createdByUserId: input.reporterUserId,
    assigneeUserId: null,
    version: 1,
    createdAt: now,
    updatedAt: now,
    acknowledgedAt: null,
    resolvedAt: null,
    confirmedAt: null,
    resolutionNote: null,
  };
  await ctx.store.insertIncident(base);
  await ctx.store.appendTimeline({
    id: ctx.newId('tl'),
    incidentId,
    eventId: input.eventId,
    type: 'CREATED',
    actorUserId: input.reporterUserId,
    fromStatus: null,
    toStatus: base.status,
    detail: 'Incident opened from an attendee report.',
    at: now,
  });

  let incident = base;
  if (!needsRoom) {
    assertTransition('REPORTED', 'TRIAGED', ['SYSTEM']);
    incident = await ctx.store.updateIncident(incidentId, 1, { status: 'TRIAGED' }, now);
    await ctx.store.appendTimeline({
      id: ctx.newId('tl'),
      incidentId,
      eventId: input.eventId,
      type: 'STATUS_CHANGED',
      actorUserId: null,
      fromStatus: 'REPORTED',
      toStatus: 'TRIAGED',
      detail: 'Triaged automatically from classification.',
      at: now,
    });
  }

  const reportId = ctx.newId('rpt');
  await ctx.store.insertReport({
    id: reportId,
    incidentId,
    eventId: input.eventId,
    reporterUserId: input.reporterUserId,
    text: input.text,
    createdAt: now,
    matchConfidence: 1,
    matchSignals: ['originating-report'],
  });
  await audit(ctx, input.eventId, input.reporterUserId, 'incident.created', 'incident', incidentId, title);
  await notifyOperations(ctx, incident, input.reporterUserId, `New report: ${title}`);

  return { incident, attached: false, duplicate: null, reportId };
}

export function buildTitle(category: IncidentCategory, roomName: string | null, equipment: readonly string[]): string {
  const where = roomName ? ` in ${roomName}` : '';
  switch (category) {
    case 'AV':
      return equipment.length > 0 ? `${capitalise(equipment[0] ?? 'AV equipment')} fault${where}` : `AV problem${where}`;
    case 'CAPACITY':
      return `Overcrowding${where}`;
    case 'ACCESSIBILITY':
      return `Accessibility concern${where}`;
    case 'FACILITIES':
      return `Facilities issue${where}`;
    case 'SCHEDULE':
      return `Schedule discrepancy${where}`;
    case 'GENERAL':
      return `Assistance request${where}`;
  }
}

function capitalise(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export async function listIncidentsForViewer(
  ctx: ServiceContext,
  eventId: string,
  userId: string,
): Promise<Array<{ incident: Incident; reportCount: number; isMine: boolean }>> {
  const membership = await ctx.store.findMembership(eventId, userId);
  if (!membership) {
    throw new DomainError('FORBIDDEN', 'You are not a member of this event.');
  }
  const operational = authorize(membership, 'incident.read.operational', eventId).allowed;
  const incidents = await ctx.store.listIncidents(eventId);
  const reports = await ctx.store.listReportsForEvent(eventId);
  const rows: Array<{ incident: Incident; reportCount: number; isMine: boolean }> = [];
  for (const incident of incidents) {
    const reportCount = reports.filter((r) => r.incidentId === incident.id).length;
    const isMine = incident.createdByUserId === userId || reports.some((r) => r.incidentId === incident.id && r.reporterUserId === userId);
    if (!operational && !isMine) continue;
    rows.push({ incident, reportCount, isMine });
  }
  return rows.sort((a, b) => b.incident.updatedAt - a.incident.updatedAt);
}
