import { z } from 'zod';
import { DomainError } from '@/domain/errors';
import { authorize } from '@/domain/permissions';
import type { ScheduleChange, ScheduleProposal } from '@/domain/product';
import { INCIDENT_DISRUPTION, worldFromEvent, type EventWorld } from '@/domain/resilience/event-world';
import { resolve } from '@/domain/resilience/repair';
import { verifyExact } from '@/domain/resilience/verify';
import { DISRUPTIONS, DISRUPTION_LABEL, makeSchedule, maskOf, type DisruptionId } from '@/domain/resilience/world';
import { audit, notify, requireCapability, type ServiceContext } from './context';

/**
 * Steadfast in the event: reproduce an incident on the live schedule, search for failure combinations, propose
 * a fix, let the Critic attack it, verify all 256 disruption subsets, and stop at a human approval card.
 *
 * Authority: operations staff and organisers may run a check (`approval.request`); only someone who may decide
 * approvals (`approval.decide`) may approve, and only through a signed-in session, never an access token or
 * an agent. No schedule changes and no one is told anything about a new schedule before approval.
 */

export const RunCheckSchema = z.object({
  incidentId: z.string().min(1).max(80).nullable().optional(),
  disruptions: z.array(z.enum(DISRUPTIONS)).max(8).optional(),
});

export const DecideSchema = z.object({ decision: z.enum(['APPROVE', 'REJECT']) });

async function eventWorld(ctx: ServiceContext, eventId: string, incidentRoomId: string | null): Promise<EventWorld> {
  const [rooms, sessions] = await Promise.all([ctx.store.listRooms(eventId), ctx.store.listSessions(eventId)]);
  return worldFromEvent({ eventId, rooms, sessions, now: ctx.now(), incidentRoomId });
}

export async function runResilienceCheck(ctx: ServiceContext, eventId: string, userId: string, input: z.infer<typeof RunCheckSchema>): Promise<ScheduleProposal> {
  await requireCapability(ctx, eventId, userId, 'approval.request');
  const incident = input.incidentId ? await ctx.store.getIncident(input.incidentId) : null;
  if (input.incidentId && (!incident || incident.eventId !== eventId)) throw new DomainError('NOT_FOUND', 'Incident not found.');
  const disruptions: DisruptionId[] = input.disruptions?.length ? input.disruptions : incident ? [INCIDENT_DISRUPTION[incident.category]] : [];
  if (disruptions.length === 0) throw new DomainError('VALIDATION_FAILED', 'Choose an incident or at least one disruption to check.');

  const ew = await eventWorld(ctx, eventId, incident?.roomId ?? null);
  if (ew.world.sessions.length === 0) throw new DomainError('INELIGIBLE', 'No upcoming sessions to check.');
  const analysis = resolve(ew.world, ew.baseline, maskOf(disruptions));
  const titles = new Map(ew.world.sessions.map((s) => [s.id, s.title] as const));
  const changes: ScheduleChange[] = (analysis.recommended?.changes ?? []).map((c) => ({
    sessionId: c.sessionId,
    title: titles.get(c.sessionId) ?? c.sessionId,
    fromRoomId: c.from.roomId,
    toRoomId: c.to.roomId,
    fromStartsAt: ew.slotStarts[c.from.slot] as number,
    toStartsAt: ew.slotStarts[c.to.slot] as number,
  }));
  const audience = await affectedPeople(ctx, eventId, changes.map((c) => c.sessionId));

  const proposal: ScheduleProposal = {
    id: ctx.newId('sfp'),
    eventId,
    incidentId: incident?.id ?? null,
    createdByUserId: userId,
    createdAt: ctx.now(),
    worldId: ew.world.id,
    worldVersion: ew.world.version,
    baselineVersion: ew.baseline.version,
    proposedVersion: analysis.recommended?.schedule.version ?? null,
    incident: disruptions,
    changes,
    cost: analysis.recommended?.cost.total ?? null,
    certificate: analysis.recommended ? { digest: analysis.recommended.certificate.digest, subsetsChecked: analysis.recommended.certificate.subsetsChecked, allPass: analysis.recommended.certificate.allPass } : null,
    evidence: {
      baselineViolations: [...new Set(analysis.baseline.violations.map((v) => `${titles.get(v.sessionId) ?? v.sessionId}: ${v.detail}`))].slice(0, 8),
      affectedSessions: analysis.baseline.affectedSessions,
      minimalFailingSets: analysis.discovery.minimalFailingSets.map((set) => set.map((d) => DISRUPTION_LABEL[d])),
      monotone: analysis.monotonicity.monotone,
      searchQueries: analysis.discovery.queries,
      criticRounds: analysis.rounds.length,
      strongestAttack: analysis.strongestAttack,
      rejected: analysis.rejected
        .filter((r) => !analysis.recommended || r.cost.total < analysis.recommended.cost.total)
        .slice(0, 5)
        .map((r) => ({ cost: r.cost.total, moves: r.changes.length, failsUnder: (r.failsUnder?.disruptions ?? []).map((d) => DISRUPTION_LABEL[d]), constraints: r.failsUnder?.constraints ?? [], by: r.rejectedBy ?? '' })),
    },
    wouldNotify: { speakers: audience.speakers.size, attendees: audience.attendees.size, staff: audience.staff.size },
    status: analysis.recommended ? 'AWAITING_APPROVAL' : 'NO_CERTIFIED_FIX',
    decidedByUserId: null,
    decidedAt: null,
    notified: 0,
  };
  await ctx.store.docPut('scheduleProposals', proposal);
  await audit(ctx, eventId, userId, 'resilience.check', 'scheduleProposal', proposal.id, `Checked ${disruptions.join(', ')}: ${proposal.status}, ${changes.length} changes.`);
  return proposal;
}

/** The people a schedule change concerns: speakers of moved sessions, attendees who planned or hold them, staff. */
async function affectedPeople(ctx: ServiceContext, eventId: string, sessionIds: string[]) {
  const moved = new Set(sessionIds);
  const sessions = (await ctx.store.listSessions(eventId)).filter((s) => moved.has(s.id));
  const speakers = new Set(sessions.map((s) => s.speakerUserId).filter((x): x is string => x !== null));
  const attendees = new Set<string>();
  for (const plan of await ctx.store.docList('plans', { eventId })) if (plan.sessionIds.some((id) => moved.has(id))) attendees.add(plan.userId);
  const now = ctx.now();
  for (const ledger of await ctx.store.docList('seatLedgers', { eventId })) {
    if (!moved.has(ledger.sessionId)) continue;
    for (const [uid, expires] of Object.entries(ledger.holds)) if (expires > now) attendees.add(uid);
  }
  for (const s of speakers) attendees.delete(s);
  const staff = new Set((await ctx.store.listMemberships(eventId)).filter((m) => authorize(m, 'incident.read.operational', eventId).allowed).map((m) => m.userId));
  return { speakers, attendees, staff };
}

export async function listProposals(ctx: ServiceContext, eventId: string, userId: string): Promise<ScheduleProposal[]> {
  await requireCapability(ctx, eventId, userId, 'approval.request');
  return (await ctx.store.docList('scheduleProposals', { eventId })).sort((a, b) => b.createdAt - a.createdAt);
}

export async function decideProposal(ctx: ServiceContext, eventId: string, userId: string, proposalId: string, decision: 'APPROVE' | 'REJECT'): Promise<ScheduleProposal> {
  await requireCapability(ctx, eventId, userId, 'approval.decide');
  const proposal = await ctx.store.docGet('scheduleProposals', proposalId);
  if (!proposal || proposal.eventId !== eventId) throw new DomainError('NOT_FOUND', 'Proposal not found.');
  if (proposal.status !== 'AWAITING_APPROVAL') throw new DomainError('APPROVAL_NOT_DECIDABLE', 'This proposal has already been decided or has no certified fix.');

  if (decision === 'REJECT') {
    const rejected = await ctx.store.docMutate('scheduleProposals', proposalId, (p) => (p.status === 'AWAITING_APPROVAL' ? { ...p, status: 'REJECTED', decidedByUserId: userId, decidedAt: ctx.now() } : null));
    if (!rejected) throw new DomainError('ALREADY_HANDLED', 'Someone decided this proposal first.');
    await audit(ctx, eventId, userId, 'resilience.reject', 'scheduleProposal', proposalId, 'Rejected.');
    return rejected;
  }

  // Revalidate against the live schedule: the certificate is only for the exact version it checked.
  const incident = proposal.incidentId ? await ctx.store.getIncident(proposal.incidentId) : null;
  const ew = await eventWorld(ctx, eventId, incident?.roomId ?? null);
  const placements = { ...ew.baseline.placements };
  for (const c of proposal.changes) {
    const slot = ew.slotStarts.indexOf(c.toStartsAt);
    placements[c.sessionId] = { roomId: c.toRoomId, slot };
  }
  const proposed = makeSchedule(placements);
  const fresh = ew.world.version === proposal.worldVersion && ew.baseline.version === proposal.baselineVersion && proposed.version === proposal.proposedVersion;
  const cert = fresh ? verifyExact(ew.world, proposed) : null;
  if (!fresh || !cert?.allPass || cert.digest !== proposal.certificate?.digest) {
    await ctx.store.docMutate('scheduleProposals', proposalId, (p) => (p.status === 'AWAITING_APPROVAL' ? { ...p, status: 'STALE' } : null));
    await audit(ctx, eventId, userId, 'resilience.stale', 'scheduleProposal', proposalId, 'The schedule changed after verification; the proposal was not applied.');
    throw new DomainError('VERSION_CONFLICT', 'The schedule or venue changed after this proposal was verified. Run the check again.');
  }

  // Win the transition once: a second approver gets ALREADY_HANDLED and nothing is applied twice.
  const approved = await ctx.store.docMutate('scheduleProposals', proposalId, (p) => (p.status === 'AWAITING_APPROVAL' ? { ...p, status: 'APPROVED', decidedByUserId: userId, decidedAt: ctx.now() } : null));
  if (!approved) throw new DomainError('ALREADY_HANDLED', 'Someone decided this proposal first.');

  for (const c of proposal.changes) {
    await ctx.store.updateSession(c.sessionId, { roomId: c.toRoomId, startsAt: c.toStartsAt, endsAt: c.toStartsAt + (ew.durations[c.sessionId] ?? 0) });
  }
  await audit(ctx, eventId, userId, 'resilience.approve', 'scheduleProposal', proposalId, `Applied ${proposal.changes.length} changes; certificate ${cert.digest}.`);

  const audience = await affectedPeople(ctx, eventId, proposal.changes.map((c) => c.sessionId));
  const rooms = new Map((await ctx.store.listRooms(eventId)).map((r) => [r.id, r.name] as const));
  const lines = proposal.changes.map((c) => `${c.title}: now ${rooms.get(c.toRoomId) ?? c.toRoomId}${c.toStartsAt !== c.fromStartsAt ? `, ${new Date(c.toStartsAt).toISOString().slice(11, 16)} UTC` : ''}`);
  let notified = 0;
  const tell = async (recipientUserId: string, body: string) => {
    if (await notify(ctx, { eventId, recipientUserId, kind: 'SCHEDULE_CHANGE', body, href: `/events/${eventId}`, dedupeParts: [proposalId] })) notified += 1;
  };
  for (const uid of audience.speakers) await tell(uid, `Your session moved. ${lines.join(' · ')}`);
  for (const uid of audience.attendees) await tell(uid, `A session in your plan moved. ${lines.join(' · ')}`);
  for (const uid of audience.staff) if (uid !== userId) await tell(uid, `Approved schedule change (${proposal.changes.length}). ${lines.join(' · ')}`);
  return (await ctx.store.docMutate('scheduleProposals', proposalId, (p) => ({ ...p, notified }))) ?? approved;
}

export const DISRUPTION_CHOICES = DISRUPTIONS.map((id) => ({ id, label: DISRUPTION_LABEL[id] }));
