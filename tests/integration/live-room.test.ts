import { describe, expect, it } from 'vitest';
import { createHarness } from './harness';
import { DomainError } from '@/domain/errors';
import { DEMO_T0 } from '@/store/seed';
import { answerBetter, askQuestion, careInfo, holdSeat, liveRoom, planB, releaseSeat, setRoomFull, signalAv, togglePlanned, todaySummary, venueBoard, voteQuestion } from '@/services/live-room';
import { transitionIncident } from '@/services/incidents';
import { eraseMe, exportMyData } from '@/services/rights';

const HOUR = 3_600_000;
// "Robotics in Practice" runs in the Main Hall from T0+4h; "Satellite Power Systems" (full) in Room 3.
const DURING = DEMO_T0 + 4 * HOUR + 10 * 60_000;

async function code(p: Promise<unknown>): Promise<string> {
  return p.then(
    () => 'OK',
    (e: unknown) => (e instanceof DomainError ? e.code : `THREW ${String(e)}`),
  );
}

describe("Live room: can't hear / can't see (Test C)", () => {
  it('raises exactly one AV incident from three distinct people, however often each taps', async () => {
    const h = await createHarness();
    h.setNow(DURING);
    const before = (await h.store.listIncidents(h.eventId)).length;
    const u = h.users;
    // One person tapping five times is one signal.
    for (let i = 0; i < 5; i += 1) expect((await signalAv(h.ctx, h.eventId, u.attendeeAda, 's-robotics', 'CANT_HEAR')).raised).toBe(false);
    expect((await signalAv(h.ctx, h.eventId, u.attendeeBen, 's-robotics', 'CANT_HEAR')).distinct).toBe(2);
    const third = await signalAv(h.ctx, h.eventId, u.attendeeChloe, 's-robotics', 'CANT_HEAR');
    expect(third.raised).toBe(true);
    const incidents = await h.store.listIncidents(h.eventId);
    expect(incidents).toHaveLength(before + 1);
    const av = incidents.find((i) => i.id === third.incidentId);
    expect(av).toMatchObject({ category: 'AV', roomId: 'r-main' });

    // A fourth person adds to the same problem but does not open another incident.
    await signalAv(h.ctx, h.eventId, u.attendeeDev, 's-robotics', 'CANT_HEAR');
    expect(await h.store.listIncidents(h.eventId)).toHaveLength(before + 1);

    // Staff see it on the venue board; attendees cannot read the board.
    const board = await venueBoard(h.ctx, h.eventId, u.opsKiri);
    expect(board.find((r) => r.sessionId === 's-robotics')?.cantHear).toBe(4);
    expect(await code(venueBoard(h.ctx, h.eventId, u.attendeeAda))).toBe('FORBIDDEN');

    // After the repair, the reporters are asked "Better now?"; "still bad" from three raises it again.
    const id = third.incidentId as string;
    await transitionIncident(h.ctx, { eventId: h.eventId, incidentId: id, actorUserId: u.opsKiri, to: 'ACKNOWLEDGED', expectedVersion: await h.versionOf(id) }).catch(() => undefined);
    const room = await liveRoom(h.ctx, h.eventId, u.attendeeAda, 's-robotics');
    expect(room.myAv[0]?.kind).toBe('CANT_HEAR');
    expect(room.staff).toBeNull();
    await answerBetter(h.ctx, h.eventId, u.attendeeAda, 's-robotics', 'CANT_HEAR', true);
    expect((await liveRoom(h.ctx, h.eventId, u.attendeeAda, 's-robotics')).myAv[0]?.state).toBe('BETTER');
  });

  it('does not count signals older than 60 seconds', async () => {
    const h = await createHarness();
    h.setNow(DURING);
    await signalAv(h.ctx, h.eventId, h.users.attendeeAda, 's-robotics', 'CANT_SEE');
    await signalAv(h.ctx, h.eventId, h.users.attendeeBen, 's-robotics', 'CANT_SEE');
    h.setNow(DURING + 61_000);
    expect((await signalAv(h.ctx, h.eventId, h.users.attendeeChloe, 's-robotics', 'CANT_SEE')).raised).toBe(false);
  });

  it('refuses signals for a session that is not running', async () => {
    const h = await createHarness();
    expect(await code(signalAv(h.ctx, h.eventId, h.users.attendeeAda, 's-sat-comms', 'CANT_HEAR'))).toBe('INELIGIBLE');
  });
});

describe('Live room questions', () => {
  it('groups similar questions and hides who asked from other attendees', async () => {
    const h = await createHarness();
    h.setNow(DURING);
    await askQuestion(h.ctx, h.eventId, h.users.attendeeAda, 's-robotics', 'How do robots handle sensor failures?');
    await askQuestion(h.ctx, h.eventId, h.users.attendeeBen, 's-robotics', 'What happens when a robot sensor fails?');
    const q3 = await askQuestion(h.ctx, h.eventId, h.users.attendeeChloe, 's-robotics', 'Which programming language do you use?');
    await voteQuestion(h.ctx, h.eventId, h.users.attendeeDev, q3.id);
    const room = await liveRoom(h.ctx, h.eventId, h.users.attendeeDev, 's-robotics');
    expect(room.questions).toHaveLength(2);
    const sensor = room.questions.find((g) => g.questions.length === 2);
    expect(sensor).toBeTruthy();
    expect(JSON.stringify(room.questions)).not.toContain('u-att-');
  });
});

describe('Plan B and seat holds (Test F)', () => {
  it('never holds more seats than are free, even under concurrent requests', async () => {
    const h = await createHarness();
    h.setNow(DEMO_T0 + 3 * HOUR);
    // Edge Computing at Scale: capacity 80, 30 enrolled, so 50 free. Fill 47 by hand, then race 10 people.
    const ledgerHolds = Object.fromEntries(Array.from({ length: 47 }, (_, i) => [`seed-${i}`, DEMO_T0 + 10 * HOUR]));
    await h.store.docPut('seatLedgers', { id: 's-edge', eventId: h.eventId, sessionId: 's-edge', holds: ledgerHolds, closed: false });
    const racers = [h.users.attendeeAda, h.users.attendeeBen, h.users.attendeeChloe, h.users.attendeeDev, h.users.attendeeEli, h.users.attendeeFatima, h.users.attendeeGus, h.users.attendeeHana, h.users.speakerInes, h.users.volunteerJamal];
    const results = await Promise.all(racers.map((u) => code(holdSeat(h.ctx, h.eventId, u, 's-edge'))));
    expect(results.filter((r) => r === 'OK')).toHaveLength(3);
    expect(results.filter((r) => r === 'INELIGIBLE')).toHaveLength(7);
    const ledger = await h.store.docGet('seatLedgers', 's-edge');
    expect(Object.keys(ledger?.holds ?? {})).toHaveLength(50);
  });

  it('releases expired holds and lets the person release their own', async () => {
    const h = await createHarness();
    h.setNow(DEMO_T0 + 3 * HOUR);
    const hold = await holdSeat(h.ctx, h.eventId, h.users.attendeeAda, 's-edge');
    expect(hold.expiresAt).toBe(DEMO_T0 + 3 * HOUR + 10 * 60_000);
    await releaseSeat(h.ctx, h.eventId, h.users.attendeeAda, 's-edge');
    expect((await h.store.docGet('seatLedgers', 's-edge'))?.holds).toEqual({});
  });

  it('offers a feasible, explained alternative when a planned session is full, and respects step-free needs', async () => {
    const h = await createHarness();
    h.setNow(DEMO_T0 + 3 * HOUR + 30 * 60_000);
    await togglePlanned(h.ctx, h.eventId, h.users.attendeeAda, 's-sat-power');
    await setRoomFull(h.ctx, h.eventId, h.users.opsKiri, 's-sat-power', true);
    expect(await code(setRoomFull(h.ctx, h.eventId, h.users.attendeeAda, 's-sat-power', false))).toBe('FORBIDDEN');
    expect(await code(holdSeat(h.ctx, h.eventId, h.users.attendeeBen, 's-sat-power'))).toBe('INELIGIBLE');

    const plan = await planB(h.ctx, h.eventId, h.users.attendeeAda, 's-sat-power');
    expect(plan.options.length).toBeGreaterThan(0);
    expect(plan.options.map((o) => o.sessionId)).not.toContain('s-sat-power');
    for (const o of plan.options) {
      expect(o.seats).toBeGreaterThan(0);
      expect(o.reasons.length).toBeGreaterThan(0);
    }
    const today = await todaySummary(h.ctx, h.eventId, h.users.attendeeAda);
    expect(today.next).toMatchObject({ id: 's-sat-power', full: true });
    expect(today.alternative).not.toBeNull();

    // Step-free: Room 2 has stairs, so Zero Trust (Room 2) is never offered to someone who asked for step-free.
    await h.store.docMutate('plans', `${h.eventId}:${h.users.attendeeAda}`, (p) => ({ ...p, stepFree: true }));
    const stepFree = await planB(h.ctx, h.eventId, h.users.attendeeAda, 's-sat-power');
    expect(stepFree.options.map((o) => o.sessionId)).not.toContain('s-zero-trust');
  });
});

describe('Care and personal data (Tests G, H)', () => {
  it('lists the quiet room, toilets, step-free access and help points from the venue', async () => {
    const h = await createHarness();
    const care = await careInfo(h.ctx, h.eventId, h.users.attendeeAda);
    expect(care.quiet.map((q) => q.name)).toContain('Quiet room');
    expect(care.toilets.length).toBeGreaterThan(0);
    expect(care.stepFree.length).toBeGreaterThan(0);
    expect(care.help.length).toBeGreaterThan(0);
  });

  it('exports and erases the plan, signals, questions and holds', async () => {
    const h = await createHarness();
    h.setNow(DURING);
    await togglePlanned(h.ctx, h.eventId, h.users.attendeeAda, 's-edge');
    await signalAv(h.ctx, h.eventId, h.users.attendeeAda, 's-robotics', 'CANT_HEAR');
    await askQuestion(h.ctx, h.eventId, h.users.attendeeAda, 's-robotics', 'Will the slides be shared?');
    await holdSeat(h.ctx, h.eventId, h.users.attendeeAda, 's-edge');
    const exported = (await exportMyData(h.ctx, h.users.attendeeAda)) as unknown as { companion: { plans: unknown[]; avSignals: unknown[]; questions: unknown[]; seatHolds: unknown[] } };
    expect(exported.companion.plans).toHaveLength(1);
    expect(exported.companion.avSignals).toHaveLength(1);
    expect(exported.companion.questions).toHaveLength(1);
    expect(exported.companion.seatHolds).toHaveLength(1);
    await eraseMe(h.ctx, h.users.attendeeAda);
    expect(await h.store.docList('plans', { userId: h.users.attendeeAda })).toEqual([]);
    expect(await h.store.docList('avSignals', { userId: h.users.attendeeAda })).toEqual([]);
    expect(await h.store.docList('liveQuestions', { authorId: h.users.attendeeAda })).toEqual([]);
    expect(Object.keys((await h.store.docGet('seatLedgers', 's-edge'))?.holds ?? {})).not.toContain(h.users.attendeeAda);
  });
});
