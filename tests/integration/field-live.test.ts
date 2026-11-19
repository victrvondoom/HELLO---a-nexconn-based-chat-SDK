import { describe, expect, it } from 'vitest';
import { createHarness, type Harness } from './harness';
import {
  adjustXp,
  dismissFlag,
  issueStation,
  manageSnapshot,
  playerState,
  reviewAttempt,
  saveMission,
  saveSeason,
  seasonsForViewer,
  startMission,
  submitMission,
} from '@/services/field-atlas';
import { atlasHome, fieldConditions } from '@/services/field-live';
import { draftMonthlyChallenge, fieldGuide, recommendFor } from '@/services/quest-director';
import { runWorkflow } from '@/services/workflows';
import { DomainError } from '@/domain/errors';
import { DEMO_NOW } from '@/store/seed';

const organiser = (h: Harness) => h.users.organiserNadia;
const ada = (h: Harness) => h.users.attendeeAda;

async function expectDomainError(promise: Promise<unknown>, code: string) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(DomainError);
  expect((error as DomainError).code).toBe(code);
}

async function completePlanDay(h: Harness, userId: string) {
  await startMission(h.ctx, h.eventId, userId, 'fm-plan-day');
  await runWorkflow(h.ctx, h.eventId, userId, 'my-day', 'CANVAS');
  return submitMission(h.ctx, h.eventId, userId, 'fm-plan-day', { text: '', checkInCode: '' });
}

function season(overrides: Record<string, unknown>) {
  return {
    id: 'season-extra',
    year: 2026,
    month: 11,
    title: 'Planner sprint',
    theme: 'Plan the day before anything else.',
    description: 'A short extra challenge that needs only the day planner.',
    artwork: 'route',
    bonusXp: 50,
    missionIds: ['fm-plan-day'],
    requiredMissionIds: ['fm-plan-day'],
    status: 'PUBLISHED',
    ...overrides,
  };
}

describe('Field Atlas fixes', () => {
  it('keeps one open flag per person and mission however often submit is retried', async () => {
    const h = await createHarness();
    await adjustXp(h.ctx, h.eventId, organiser(h), ada(h), 120, 'Pilot run bonus for testing.');
    await startMission(h.ctx, h.eventId, ada(h), 'fm-gallery-route');
    const attemptId = `fm-gallery-route:${ada(h)}`;
    for (const text of ['first attempt, too short', 'second attempt with more detail', 'third attempt with the lift and the gallery']) {
      await submitMission(h.ctx, h.eventId, ada(h), 'fm-gallery-route', { text, checkInCode: '' });
      await reviewAttempt(h.ctx, h.eventId, organiser(h), attemptId, 'REJECT', 'Describe the route in more detail.');
    }
    for (let i = 0; i < 5; i += 1) {
      await expectDomainError(submitMission(h.ctx, h.eventId, ada(h), 'fm-gallery-route', { text: 'another try at it', checkInCode: '' }), 'RATE_LIMITED');
    }
    const open = (await manageSnapshot(h.ctx, h.eventId, organiser(h))).flags.filter((f) => f.kind === 'REPEATED_SUBMISSIONS');
    expect(open).toHaveLength(1);
    // The flag id does not carry the user id, so erasure's unlinking is complete.
    expect(open[0]?.id).not.toContain(ada(h));
    await dismissFlag(h.ctx, h.eventId, organiser(h), open[0]?.id ?? '');
    // A fresh occurrence after a dismissal is flagged again, once.
    await expectDomainError(submitMission(h.ctx, h.eventId, ada(h), 'fm-gallery-route', { text: 'and again later', checkInCode: '' }), 'RATE_LIMITED');
    await expectDomainError(submitMission(h.ctx, h.eventId, ada(h), 'fm-gallery-route', { text: 'and again later', checkInCode: '' }), 'RATE_LIMITED');
    const after = (await manageSnapshot(h.ctx, h.eventId, organiser(h))).flags.filter((f) => f.kind === 'REPEATED_SUBMISSIONS');
    expect(after).toHaveLength(1);
    expect(after[0]?.id).not.toBe(open[0]?.id);
  });

  it('awards a season whose last required mission belongs to another season', async () => {
    const h = await createHarness();
    // fm-plan-day's own seasonId is the seeded November season. Before the fix only that season was checked.
    await saveSeason(h.ctx, h.eventId, organiser(h), season({}));
    const done = await completePlanDay(h, ada(h));
    expect(done.outcome).toBe('APPROVED');
    expect(done.badges.map((b) => b.name)).toContain('Planner sprint');
    expect(done.xpAwarded).toBe(25 + 50);
  });

  it('does not award a bonus for a draft or paused season', async () => {
    const h = await createHarness();
    await saveSeason(h.ctx, h.eventId, organiser(h), season({ status: 'DRAFT' }));
    const done = await completePlanDay(h, ada(h));
    expect(done.xpAwarded).toBe(25);
    expect(done.badges.some((b) => b.name === 'Planner sprint')).toBe(false);
  });

  it('counts only approvals inside the season window toward "required left"', async () => {
    const h = await createHarness();
    await completePlanDay(h, ada(h)); // approved in November
    await saveSeason(h.ctx, h.eventId, organiser(h), season({ id: 'season-dec', month: 12, title: 'December planner' }));
    h.setNow(Date.UTC(2026, 11, 2, 9, 0));
    const { current } = await seasonsForViewer(h.ctx, h.eventId, ada(h));
    expect(current?.id).toBe('season-dec');
    // The November approval does not count for December, matching the award rule.
    expect(current?.requiredRemaining).toBe(1);
  });

  it('refuses an adjustment that would take a person below zero XP', async () => {
    const h = await createHarness();
    await adjustXp(h.ctx, h.eventId, organiser(h), ada(h), 30, 'Helped set up the registration desk.');
    await expectDomainError(adjustXp(h.ctx, h.eventId, organiser(h), ada(h), -40, 'Correcting a duplicated manual award.'), 'VALIDATION_FAILED');
    expect((await adjustXp(h.ctx, h.eventId, organiser(h), ada(h), -30, 'Correcting a duplicated manual award.')).xp).toBe(0);
    expect((await playerState(h.ctx, h.eventId, ada(h))).xp).toBe(0);
  });

  it('adds missions from a re-draft to the existing season instead of orphaning them', async () => {
    const h = await createHarness();
    const first = await draftMonthlyChallenge(h.ctx, h.eventId, organiser(h), { year: 2026, month: 12 });
    expect(first.unavailable.some((u) => u.includes('Room 2'))).toBe(true);
    await issueStation(h.ctx, h.eventId, organiser(h), 'sp-r2', 'Room 2 door', 'st-room-2');
    const second = await draftMonthlyChallenge(h.ctx, h.eventId, organiser(h), { year: 2026, month: 12 });
    expect(second.created).toBe(1);
    const stored = await h.store.docGet('fieldSeasons', 'season-2026-12');
    expect(stored?.missionIds).toContain('season-2026-12-visit-r-2');
    // Still a draft season, so the new check-in mission also becomes a requirement.
    expect(stored?.requiredMissionIds).toContain('season-2026-12-visit-r-2');
    expect(stored?.requiredMissionIds).not.toContain('season-2026-12-connect');
  });
});

describe('Field Conditions', () => {
  it('describes Room 3 from its open incidents, occupancy and schedule, without incident text', async () => {
    const h = await createHarness();
    const conditions = await fieldConditions(h.ctx, h.eventId, ada(h));
    const r3 = conditions['sp-r3'];
    expect(r3?.level).toBe('AVOID');
    expect(r3?.signals.map((s) => s.kind).sort()).toEqual(['CROWD', 'INCIDENT', 'INCIDENT'].sort());
    const json = JSON.stringify(conditions);
    // Reports and titles stay with staff: an attendee sees a category and a count.
    expect(json).not.toMatch(/crackling|overcrowded|cannot get in/i);
    expect(json).not.toContain('inc-seed');
    // Room 2's only incident is closed, and its occupancy is low.
    expect(conditions['sp-r2']).toBeUndefined();
  });

  it('changes as soon as an incident is resolved', async () => {
    const h = await createHarness();
    for (const id of ['inc-seed-av-r3', 'inc-seed-cap-r3']) {
      await h.store.updateIncident(id, await h.versionOf(id), { status: 'RESOLVED', resolvedAt: h.now() }, h.now());
    }
    const r3 = (await fieldConditions(h.ctx, h.eventId, ada(h)))['sp-r3'];
    expect(r3?.signals.some((s) => s.kind === 'INCIDENT')).toBe(false);
    // The room is still over capacity, so it is still flagged, for that reason only.
    expect(r3?.signals.map((s) => s.kind)).toContain('CROWD');
  });

  it('ranks a mission in an affected place lower and cites the condition', async () => {
    const h = await createHarness();
    await saveMission(h.ctx, h.eventId, organiser(h), {
      id: 'fm-r3-quick',
      title: 'Quick look at Room 3',
      description: 'Pop into Room 3 and check in at the station by the door.',
      whyItMatters: 'Room 3 hosts the hands-on workshops.',
      category: 'EXPLORATION',
      difficulty: 'EASY',
      requiredLevel: 0,
      xp: 200,
      seasonId: null,
      spaceId: 'sp-r3',
      nonLocation: false,
      prerequisiteIds: [],
      verification: { method: 'CHECK_IN', stationId: 'st-room-3' },
      estimateMinutes: 5,
      accessibilityNote: '',
      startsAt: null,
      endsAt: null,
      status: 'PUBLISHED',
      maxCompletionsPerPerson: 1,
      source: 'ORGANISER',
    });
    const recs = await recommendFor(h.ctx, h.eventId, ada(h), { minutes: null, startSpaceId: null, stepFree: false });
    // The highest reward would normally rank first; the live condition moves it down.
    expect(recs.recommendations[0]?.missionId).not.toBe('fm-r3-quick');
    expect(recs.note).toMatch(/Live conditions/);
    const guide = await fieldGuide(h.ctx, h.eventId, ada(h), 'fm-r3-quick');
    const now = guide.answers.find((a) => a.question === 'Is now a good time to go?');
    expect(now?.text).toMatch(/come back later/i);
    expect(now?.citations[0]?.kind).toBe('condition');
  });
});

describe('Season pulse', () => {
  it('shows momentum only once at least three people are involved', async () => {
    const h = await createHarness();
    const people = [h.users.attendeeAda, h.users.attendeeBen, h.users.attendeeChloe];
    await completePlanDay(h, people[0] ?? '');
    await completePlanDay(h, people[1] ?? '');
    const two = (await atlasHome(h.ctx, h.eventId, ada(h))).pulse;
    expect(two.missions.find((m) => m.missionId === 'fm-plan-day')?.verifiedLastHour).toBeNull();
    expect(two.participants).toBeNull();
    await completePlanDay(h, people[2] ?? '');
    const three = (await atlasHome(h.ctx, h.eventId, ada(h))).pulse;
    expect(three.missions.find((m) => m.missionId === 'fm-plan-day')).toMatchObject({ verifiedLastHour: 3, completedTotal: 3 });
    expect(three.participants).toBe(3);
    // An hour later the momentum fades, but the total stays.
    h.setNow(DEMO_NOW + 2 * 60 * 60 * 1000);
    const later = (await atlasHome(h.ctx, h.eventId, ada(h))).pulse;
    expect(later.missions.find((m) => m.missionId === 'fm-plan-day')).toMatchObject({ verifiedLastHour: null, completedTotal: 3 });
  });
});
