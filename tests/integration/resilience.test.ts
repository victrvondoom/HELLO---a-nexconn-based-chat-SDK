import { describe, expect, it } from 'vitest';
import { createHarness } from './harness';
import { DomainError } from '@/domain/errors';
import { decideProposal, listProposals, runResilienceCheck } from '@/services/resilience';

async function code(p: Promise<unknown>): Promise<string> {
  return p.then(
    () => 'OK',
    (e: unknown) => (e instanceof DomainError ? e.code : `THREW ${String(e)}`),
  );
}

describe('CON-FUZZ on the live event (Test E)', () => {
  it('reproduces an incident, proposes a certified fix, and changes nothing until a human approves', async () => {
    const h = await createHarness();
    const before = await h.store.listSessions(h.eventId);
    const proposal = await runResilienceCheck(h.ctx, h.eventId, h.users.opsKiri, { incidentId: 'inc-seed-av-r3' });

    expect(proposal.incident).toEqual(['av_failure']);
    expect(proposal.status).toBe('AWAITING_APPROVAL');
    expect(proposal.certificate).toMatchObject({ subsetsChecked: 256, allPass: true });
    expect(proposal.changes.length).toBeGreaterThan(0);
    // Ids are the event's own: the proposal speaks about real sessions and rooms.
    const ids = new Set(before.map((s) => s.id));
    for (const c of proposal.changes) expect(ids.has(c.sessionId)).toBe(true);

    // Before approval: the schedule is untouched and nobody has been told about a new schedule.
    expect(await h.store.listSessions(h.eventId)).toEqual(before);
    const told = (await h.store.listNotifications(h.users.speakerInes)).filter((n) => n.kind === 'SCHEDULE_CHANGE');
    expect(told).toHaveLength(0);

    // Operations staff can run a check but cannot approve; attendees can do neither.
    expect(await code(decideProposal(h.ctx, h.eventId, h.users.opsKiri, proposal.id, 'APPROVE'))).toBe('FORBIDDEN');
    expect(await code(runResilienceCheck(h.ctx, h.eventId, h.users.attendeeAda, { incidentId: 'inc-seed-av-r3' }))).toBe('FORBIDDEN');
    expect(await code(listProposals(h.ctx, h.eventId, h.users.attendeeAda))).toBe('FORBIDDEN');

    const approved = await decideProposal(h.ctx, h.eventId, h.users.organiserNadia, proposal.id, 'APPROVE');
    expect(approved.status).toBe('APPROVED');
    const after = new Map((await h.store.listSessions(h.eventId)).map((s) => [s.id, s] as const));
    for (const c of proposal.changes) {
      expect(after.get(c.sessionId)).toMatchObject({ roomId: c.toRoomId, startsAt: c.toStartsAt });
    }
    expect((await h.store.listAudit(h.eventId)).some((a) => a.action === 'resilience.approve')).toBe(true);
    expect(approved.notified).toBeGreaterThan(0);

    // A second approval does nothing.
    expect(await code(decideProposal(h.ctx, h.eventId, h.users.organiserNadia, proposal.id, 'APPROVE'))).toBe('APPROVAL_NOT_DECIDABLE');
  });

  it('refuses a stale proposal when the schedule changed after verification (Test H)', async () => {
    const h = await createHarness();
    const proposal = await runResilienceCheck(h.ctx, h.eventId, h.users.organiserNadia, { incidentId: 'inc-seed-av-r3' });
    const moved = proposal.changes[0];
    if (!moved) throw new Error('expected a change');
    // Someone changes the live schedule by another route.
    await h.store.updateSession('s-zero-trust', { roomId: 'r-4' });
    expect(await code(decideProposal(h.ctx, h.eventId, h.users.organiserNadia, proposal.id, 'APPROVE'))).toBe('VERSION_CONFLICT');
    expect((await h.store.docGet('scheduleProposals', proposal.id))?.status).toBe('STALE');
    expect((await h.store.getSession(moved.sessionId))?.roomId).toBe(moved.fromRoomId);
  });

  it('notifies only the people a change concerns', async () => {
    const h = await createHarness();
    const proposal = await runResilienceCheck(h.ctx, h.eventId, h.users.organiserNadia, { incidentId: 'inc-seed-av-r3' });
    const movedIds = new Set(proposal.changes.map((c) => c.sessionId));
    await h.store.docPut('plans', { id: `${h.eventId}:${h.users.attendeeBen}`, eventId: h.eventId, userId: h.users.attendeeBen, sessionIds: [...movedIds], stepFree: false, updatedAt: 0 });
    await decideProposal(h.ctx, h.eventId, h.users.organiserNadia, proposal.id, 'APPROVE');
    const kinds = async (uid: string) => (await h.store.listNotifications(uid)).filter((n) => n.kind === 'SCHEDULE_CHANGE').length;
    expect(await kinds(h.users.attendeeBen)).toBe(1);
    expect(await kinds(h.users.attendeeHana)).toBe(0);
  });
});
