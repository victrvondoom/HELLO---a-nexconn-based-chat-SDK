import { DomainError } from '../domain/errors';
import { compileContext, type ContextScope, type ContextSnapshot } from '../domain/graph/compile';
import { projectGraph } from '../domain/graph/project';
import type { ContextGraph } from '../domain/graph/types';
import { authorize } from '../domain/permissions';
import type { SafetyHold } from '../domain/product';
import type { ServiceContext } from './context';

/**
 * Builds the Context Memory Graph for an event from the authoritative records, on demand.
 *
 * Nothing here is written back. If the safety-hold records cannot be read, the graph is still built, with
 * `holdsAvailable` false, so every consumer fails closed instead of assuming that no hold exists.
 */
export async function loadGraph(ctx: ServiceContext, eventId: string): Promise<ContextGraph> {
  const now = ctx.now();
  const venue = await ctx.store.getVenue(eventId);
  const rooms = await ctx.store.listRooms(eventId);
  const reports = await ctx.store.docList('liveReports', { eventId });
  const incidents = await ctx.store.listIncidents(eventId);
  const incidentReports = await ctx.store.listReportsForEvent(eventId);
  const memberships = await ctx.store.listMemberships(eventId);

  const people = new Map<string, string>();
  for (const membership of memberships) {
    const user = await ctx.store.getUser(membership.userId);
    if (user) people.set(user.id, user.displayName);
  }

  let holds: SafetyHold[] = [];
  let holdsAvailable = true;
  try {
    holds = await ctx.store.docList('safetyHolds', { eventId });
  } catch {
    holdsAvailable = false;
  }

  return projectGraph({
    eventId,
    now,
    spaces: venue?.spaces ?? [],
    rooms,
    reports,
    incidents,
    incidentReporters: incidentReports.map((report) => ({ incidentId: report.incidentId, reporterUserId: report.reporterUserId })),
    holds,
    holdsAvailable,
    people,
  });
}

export interface SnapshotInput {
  eventId: string;
  actorUserId: string;
  scope: ContextScope;
}

/**
 * A Context Snapshot for one person and one scope. Attendees get the public view. Operations staff get the
 * operational view. Anyone who is not a member gets nothing.
 */
export async function snapshotFor(ctx: ServiceContext, input: SnapshotInput): Promise<ContextSnapshot> {
  const membership = await ctx.store.findMembership(input.eventId, input.actorUserId);
  if (!authorize(membership, 'event.read', input.eventId).allowed) {
    throw new DomainError('FORBIDDEN', 'You are not a member of this event.');
  }
  const staff = authorize(membership, 'live.review', input.eventId).allowed;
  const graph = await loadGraph(ctx, input.eventId);
  return compileContext(graph, {
    id: ctx.newId('snap'),
    now: ctx.now(),
    viewer: { userId: input.actorUserId, staff },
    scope: input.scope,
  });
}
