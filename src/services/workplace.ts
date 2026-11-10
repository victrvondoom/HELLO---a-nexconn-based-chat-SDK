import { DomainError } from '../domain/errors';
import { isEscalationCandidate, slaFor, type SlaSnapshot } from '../domain/incidents/sla';
import { STAFF_ROLES, type AvailabilityState, type Incident, type Membership, type Notification, type Role } from '../domain/types';
import { audit, requireCapability, type ServiceContext } from './context';
import { transitionIncident } from './incidents';
import { requestApproval } from './approvals';

/**
 * Workplace features: escalation sweeps, profiles, staff availability, the team directory,
 * notification read state, announcements (through approval) and the audit trail.
 */

// ---------- SLA sweep ------------------------------------------------------

export interface SweepResult {
  checked: number;
  escalated: Array<{ incidentId: string; title: string }>;
  skipped: Array<{ incidentId: string; reason: string }>;
}

/**
 * Escalates unclaimed incidents that have passed their acknowledgement target. Each escalation goes
 * through the normal transition rules, so it is recorded on the timeline and notifies operations.
 */
export async function sweepOverdueIncidents(ctx: ServiceContext, eventId: string, actorUserId: string): Promise<SweepResult> {
  await requireCapability(ctx, eventId, actorUserId, 'incident.escalate');
  const now = ctx.now();
  const incidents = await ctx.store.listIncidents(eventId);
  const result: SweepResult = { checked: incidents.length, escalated: [], skipped: [] };

  for (const incident of incidents) {
    if (!isEscalationCandidate(incident, now)) continue;
    try {
      await transitionIncident(ctx, {
        eventId,
        actorUserId,
        incidentId: incident.id,
        to: 'ESCALATED',
        expectedVersion: incident.version,
      });
      result.escalated.push({ incidentId: incident.id, title: incident.title });
    } catch (error: unknown) {
      const reason =
        error instanceof DomainError && error.code === 'VERSION_CONFLICT'
          ? 'changed while the sweep ran'
          : error instanceof DomainError
            ? error.message
            : 'unexpected error';
      result.skipped.push({ incidentId: incident.id, reason });
    }
  }

  if (result.escalated.length > 0) {
    await audit(ctx, eventId, actorUserId, 'sla.sweep', 'event', eventId, `${result.escalated.length} incident(s) escalated for missed acknowledgement targets.`);
  }
  return result;
}

export interface SlaRow {
  incident: Incident;
  sla: SlaSnapshot;
}

/** Every open incident with its live acknowledgement timer, most urgent first. */
export async function listSlaBoard(ctx: ServiceContext, eventId: string, viewerUserId: string): Promise<SlaRow[]> {
  await requireCapability(ctx, eventId, viewerUserId, 'incident.read.operational');
  const now = ctx.now();
  const rows = (await ctx.store.listIncidents(eventId))
    .filter((i) => !['CLOSED', 'CANCELLED', 'CONFIRMED'].includes(i.status))
    .map((incident) => ({ incident, sla: slaFor(incident, now) }));
  const rank = { BREACHED: 0, AT_RISK: 1, ON_TRACK: 2, MET: 3, NOT_APPLICABLE: 4 } as const;
  return rows.sort((a, b) => rank[a.sla.state] - rank[b.sla.state] || (a.sla.remainingMinutes ?? 0) - (b.sla.remainingMinutes ?? 0));
}

// ---------- profile & availability ----------------------------------------

export interface ProfileInput {
  displayName: string;
  interests: string[];
  discoverable: boolean;
  accessibilityRequired: boolean;
}

export async function updateProfile(ctx: ServiceContext, userId: string, input: ProfileInput) {
  const cleaned = [...new Set(input.interests.map((i) => i.trim()).filter((i) => i.length > 0))].slice(0, 25);
  if (input.displayName.trim().length < 1) {
    throw new DomainError('VALIDATION_FAILED', 'Your name cannot be empty.');
  }
  return ctx.store.updateUser(userId, {
    displayName: input.displayName.trim().slice(0, 80),
    interests: cleaned,
    discoverable: input.discoverable,
    accessibilityRequired: input.accessibilityRequired,
  });
}

export async function setAvailability(
  ctx: ServiceContext,
  eventId: string,
  userId: string,
  availability: AvailabilityState,
): Promise<Membership> {
  const membership = await ctx.store.findMembership(eventId, userId);
  if (!membership || !STAFF_ROLES.includes(membership.role)) {
    throw new DomainError('FORBIDDEN', 'Only operational staff set an availability.');
  }
  const updated = await ctx.store.updateMembership(membership.id, { availability });
  await audit(ctx, eventId, userId, 'staff.availability', 'membership', membership.id, `Availability set to ${availability.toLowerCase().replace('_', ' ')}.`);
  return updated;
}

// ---------- team directory -------------------------------------------------

export interface TeamRow {
  membershipId: string;
  userId: string;
  displayName: string;
  role: Role;
  skills: string[];
  availability: AvailabilityState;
  zone: string | null;
  openAssignments: number;
  capacity: number;
}

export async function listTeam(ctx: ServiceContext, eventId: string, viewerUserId: string): Promise<TeamRow[]> {
  await requireCapability(ctx, eventId, viewerUserId, 'incident.read.operational');
  const memberships = (await ctx.store.listMemberships(eventId)).filter((m) => STAFF_ROLES.includes(m.role));
  const load = await ctx.store.countOpenAssignments(eventId);
  const rows: TeamRow[] = [];
  for (const m of memberships) {
    const user = await ctx.store.getUser(m.userId);
    rows.push({
      membershipId: m.id,
      userId: m.userId,
      displayName: user?.displayName ?? m.userId,
      role: m.role,
      skills: m.skills,
      availability: m.availability,
      zone: m.zone,
      openAssignments: load.get(m.userId) ?? 0,
      capacity: 3,
    });
  }
  const order: Record<AvailabilityState, number> = { AVAILABLE: 0, BUSY: 1, OFF_SHIFT: 2 };
  return rows.sort((a, b) => order[a.availability] - order[b.availability] || a.displayName.localeCompare(b.displayName));
}

// ---------- notifications --------------------------------------------------

export interface NotificationFeed {
  items: Notification[];
  unread: number;
}

export async function notificationFeed(ctx: ServiceContext, eventId: string, userId: string): Promise<NotificationFeed> {
  await requireCapability(ctx, eventId, userId, 'event.read');
  const items = (await ctx.store.listNotifications(userId)).filter((n) => n.eventId === eventId);
  return { items, unread: items.filter((n) => n.readAt === null).length };
}

export async function markAllNotificationsRead(ctx: ServiceContext, eventId: string, userId: string): Promise<number> {
  await requireCapability(ctx, eventId, userId, 'event.read');
  return ctx.store.markNotificationsRead(userId, eventId, ctx.now());
}

// ---------- announcements --------------------------------------------------

export async function requestAnnouncement(
  ctx: ServiceContext,
  eventId: string,
  userId: string,
  title: string,
  body: string,
) {
  const cleanTitle = title.trim();
  const cleanBody = body.trim();
  if (cleanTitle.length < 3 || cleanBody.length < 10) {
    throw new DomainError('VALIDATION_FAILED', 'An announcement needs a title of at least 3 characters and a message of at least 10.');
  }
  return requestApproval(ctx, {
    eventId,
    requestedByUserId: userId,
    actionType: 'PUBLISH_ANNOUNCEMENT',
    payload: { title: cleanTitle, body: cleanBody },
    justification: `Announcement requested by a team member: "${cleanTitle}".`,
    linkedIncidentId: null,
  });
}

export async function listAnnouncementsFor(ctx: ServiceContext, eventId: string, userId: string) {
  await requireCapability(ctx, eventId, userId, 'event.read');
  return ctx.store.listAnnouncements(eventId);
}

// ---------- audit ----------------------------------------------------------

export async function listAuditFor(ctx: ServiceContext, eventId: string, userId: string) {
  await requireCapability(ctx, eventId, userId, 'audit.read');
  return (await ctx.store.listAudit(eventId)).sort((a, b) => b.at - a.at).slice(0, 200);
}
