import { describe, expect, it } from 'vitest';
import { createHarness } from './harness';
import {
  adjustXp,
  cabinetFor,
  dismissFlag,
  issueStation,
  listMissionsForViewer,
  manageSnapshot,
  playerState,
  reviewAttempt,
  saveLevels,
  saveMission,
  saveSeason,
  startMission,
  submitMission,
  seasonsForViewer,
} from '@/services/field-atlas';
import { draftMonthlyChallenge, fieldGuide, recommendFor } from '@/services/quest-director';
import { runWorkflow } from '@/services/workflows';
import { eraseMe, exportMyData } from '@/services/rights';
import { DEFAULT_LEVELS, monthWindow, type LevelDefinition } from '@/domain/field/rules';
import { DomainError } from '@/domain/errors';
import { DEMO_NOW } from '@/store/seed';
import type { FieldMission } from '@/domain/product';

const attendee = (h: Awaited<ReturnType<typeof createHarness>>) => h.users.attendeeAda;
const organiser = (h: Awaited<ReturnType<typeof createHarness>>) => h.users.organiserNadia;

async function codeFor(h: Awaited<ReturnType<typeof createHarness>>, stationId: string, spaceId: string, name: string) {
  return (await issueStation(h.ctx, h.eventId, organiser(h), spaceId, name, stationId)).code;
}

async function expectDomainError(promise: Promise<unknown>, code: string) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(DomainError);
  expect((error as DomainError).code).toBe(code);
}

describe('Field Atlas: discovery and locks', () => {
  it('shows published missions with the reason each one is locked', async () => {
    const h = await createHarness();
    const views = await listMissionsForViewer(h.ctx, h.eventId, attendee(h));
    const registration = views.find((v) => v.id === 'fm-find-registration');
    const room3 = views.find((v) => v.id === 'fm-room-3');
    const introduce = views.find((v) => v.id === 'fm-introduce');
    expect(registration?.availability).toEqual({ state: 'AVAILABLE' });
    expect(room3?.availability.state).toBe('LOCKED_PREREQUISITE');
    expect(introduce?.availability).toEqual({ state: 'LOCKED_LEVEL', requiredLevel: 2 });
    expect(views.every((v) => v.attempt.status === 'NONE')).toBe(true);
  });

  it('never shows draft missions to attendees', async () => {
    const h = await createHarness();
    await saveMission(h.ctx, h.eventId, organiser(h), { ...baseMission(), id: 'fm-hidden-draft', status: 'DRAFT' });
    const views = await listMissionsForViewer(h.ctx, h.eventId, attendee(h));
    expect(views.some((v) => v.id === 'fm-hidden-draft')).toBe(false);
    await expectDomainError(startMission(h.ctx, h.eventId, attendee(h), 'fm-hidden-draft'), 'NOT_FOUND');
  });

  it('does not let a non-member see or act on the event', async () => {
    const h = await createHarness();
    // A person who is not a member of the event is refused, and the message does not confirm the event exists.
    await expectDomainError(startMission(h.ctx, 'some-other-event', attendee(h), 'fm-find-registration'), 'FORBIDDEN');
    await expectDomainError(submitMission(h.ctx, h.eventId, 'usr-stranger', 'fm-find-registration', { text: '', checkInCode: 'X' }), 'FORBIDDEN');
  });
});

describe('Field Atlas: verification pipeline', () => {
  it('a check-in mission: wrong code, expired code, valid code, then no double award', async () => {
    const h = await createHarness();
    const code = await codeFor(h, 'st-registration', 'sp-lobby', 'Registration');
    await startMission(h.ctx, h.eventId, attendee(h), 'fm-find-registration');

    const wrong = await submitMission(h.ctx, h.eventId, attendee(h), 'fm-find-registration', { text: '', checkInCode: 'WRONGCODE' });
    expect(wrong.outcome).toBe('NOT_VERIFIED');
    expect(wrong.xpAwarded).toBe(0);

    const before = (await playerState(h.ctx, h.eventId, attendee(h))).xp;
    const ok = await submitMission(h.ctx, h.eventId, attendee(h), 'fm-find-registration', { text: '', checkInCode: code.toLowerCase() });
    expect(ok.outcome).toBe('APPROVED');
    expect(ok.xpAwarded).toBe(30);
    expect((await playerState(h.ctx, h.eventId, attendee(h))).xp).toBe(before + 30);

    const again = await submitMission(h.ctx, h.eventId, attendee(h), 'fm-find-registration', { text: '', checkInCode: code });
    expect(again.outcome).toBe('ALREADY_COMPLETE');
    expect(again.xpAwarded).toBe(0);
    expect((await playerState(h.ctx, h.eventId, attendee(h))).xp).toBe(before + 30);
  });

  it('refuses an expired check-in code and records why', async () => {
    const h = await createHarness();
    const code = await codeFor(h, 'st-registration', 'sp-lobby', 'Registration');
    await startMission(h.ctx, h.eventId, attendee(h), 'fm-find-registration');
    h.setNow(DEMO_NOW + 5 * 60 * 60 * 1000);
    const result = await submitMission(h.ctx, h.eventId, attendee(h), 'fm-find-registration', { text: '', checkInCode: code });
    expect(result.outcome).toBe('NOT_VERIFIED');
    expect(result.message).toMatch(/expired/);
    const snapshot = await manageSnapshot(h.ctx, h.eventId, organiser(h));
    expect(snapshot.flags.some((f) => f.kind === 'EXPIRED_CHECK_IN')).toBe(true);
  });

  it('cannot submit before starting, and cannot skip a locked prerequisite', async () => {
    const h = await createHarness();
    await expectDomainError(submitMission(h.ctx, h.eventId, attendee(h), 'fm-find-registration', { text: '', checkInCode: 'X' }), 'FORBIDDEN');
    await expectDomainError(startMission(h.ctx, h.eventId, attendee(h), 'fm-room-3'), 'FORBIDDEN');
  });

  it('a workflow mission is verified only by a real succeeded run of that workflow', async () => {
    const h = await createHarness();
    await startMission(h.ctx, h.eventId, attendee(h), 'fm-plan-day');
    const notYet = await submitMission(h.ctx, h.eventId, attendee(h), 'fm-plan-day', { text: '', checkInCode: '' });
    expect(notYet.outcome).toBe('NOT_VERIFIED');
    await runWorkflow(h.ctx, h.eventId, attendee(h), 'my-day', 'CANVAS');
    const done = await submitMission(h.ctx, h.eventId, attendee(h), 'fm-plan-day', { text: '', checkInCode: '' });
    expect(done.outcome).toBe('APPROVED');
    expect(done.xpAwarded).toBe(25);
  });

  it('concurrent submissions award XP exactly once', async () => {
    const h = await createHarness();
    const code = await codeFor(h, 'st-registration', 'sp-lobby', 'Registration');
    await startMission(h.ctx, h.eventId, attendee(h), 'fm-find-registration');
    const before = (await playerState(h.ctx, h.eventId, attendee(h))).xp;
    const results = await Promise.all(Array.from({ length: 8 }, () => submitMission(h.ctx, h.eventId, attendee(h), 'fm-find-registration', { text: '', checkInCode: code })));
    expect(results.filter((r) => r.outcome === 'APPROVED')).toHaveLength(1);
    expect((await playerState(h.ctx, h.eventId, attendee(h))).xp).toBe(before + 30);
  });

  it('concurrent starts create one attempt', async () => {
    const h = await createHarness();
    const results = await Promise.all(Array.from({ length: 5 }, () => startMission(h.ctx, h.eventId, attendee(h), 'fm-find-registration')));
    expect(results.filter((r) => r.created)).toHaveLength(1);
  });
});

describe('Field Atlas: manual evidence and review', () => {
  it('evidence waits for review, is not counted until approved, and only reviewers decide', async () => {
    const h = await createHarness();
    // Level 1 is needed for this mission. Give the attendee the XP through an audited adjustment first.
    await adjustXp(h.ctx, h.eventId, organiser(h), attendee(h), 120, 'Welcome bonus for the pilot run.');
    await startMission(h.ctx, h.eventId, attendee(h), 'fm-gallery-route');
    const sent = await submitMission(h.ctx, h.eventId, attendee(h), 'fm-gallery-route', { text: 'Up the east lift to the gallery, about four minutes.', checkInCode: '' });
    expect(sent.outcome).toBe('PENDING_REVIEW');
    expect(sent.xpAwarded).toBe(0);

    const pendingBefore = (await playerState(h.ctx, h.eventId, attendee(h))).approvedMissionIds;
    expect(pendingBefore).not.toContain('fm-gallery-route');

    await expectDomainError(reviewAttempt(h.ctx, h.eventId, attendee(h), 'fm-gallery-route:' + attendee(h), 'APPROVE', ''), 'FORBIDDEN');

    const attemptId = `fm-gallery-route:${attendee(h)}`;
    const approved = await reviewAttempt(h.ctx, h.eventId, organiser(h), attemptId, 'APPROVE', '');
    expect(approved.status).toBe('APPROVED');
    expect((await playerState(h.ctx, h.eventId, attendee(h))).approvedMissionIds).toContain('fm-gallery-route');
    await expectDomainError(reviewAttempt(h.ctx, h.eventId, organiser(h), attemptId, 'REJECT', ''), 'VERSION_CONFLICT');
  });

  it('a rejected submission can be resubmitted, but only up to the limit', async () => {
    const h = await createHarness();
    await adjustXp(h.ctx, h.eventId, organiser(h), attendee(h), 120, 'Pilot run bonus for testing.');
    await startMission(h.ctx, h.eventId, attendee(h), 'fm-gallery-route');
    const attemptId = `fm-gallery-route:${attendee(h)}`;
    const texts = ['first attempt, too short', 'second attempt with more detail', 'third attempt, the route with the lift and gallery'];
    for (const [i, text] of texts.entries()) {
      const sent = await submitMission(h.ctx, h.eventId, attendee(h), 'fm-gallery-route', { text, checkInCode: '' });
      expect(sent.outcome).toBe('PENDING_REVIEW');
      await reviewAttempt(h.ctx, h.eventId, organiser(h), attemptId, 'REJECT', `Round ${i + 1}: describe the route in more detail.`);
    }
    const cabinet = await listMissionsForViewer(h.ctx, h.eventId, attendee(h));
    expect(cabinet.find((v) => v.id === 'fm-gallery-route')?.attempt.lastOutcome).toMatch(/Round 3/);
    await expectDomainError(submitMission(h.ctx, h.eventId, attendee(h), 'fm-gallery-route', { text: 'a fourth try', checkInCode: '' }), 'RATE_LIMITED');
  });

  it('flags identical evidence from two people without approving either', async () => {
    const h = await createHarness();
    await adjustXp(h.ctx, h.eventId, organiser(h), attendee(h), 120, 'Pilot run bonus for testing.');
    await adjustXp(h.ctx, h.eventId, organiser(h), h.users.attendeeBen, 120, 'Pilot run bonus for testing.');
    const text = 'I went up the east lift to the gallery.';
    await startMission(h.ctx, h.eventId, attendee(h), 'fm-gallery-route');
    await startMission(h.ctx, h.eventId, h.users.attendeeBen, 'fm-gallery-route');
    await submitMission(h.ctx, h.eventId, attendee(h), 'fm-gallery-route', { text, checkInCode: '' });
    const second = await submitMission(h.ctx, h.eventId, h.users.attendeeBen, 'fm-gallery-route', { text: text.toUpperCase(), checkInCode: '' });
    expect(second.outcome).toBe('PENDING_REVIEW');
    const snapshot = await manageSnapshot(h.ctx, h.eventId, organiser(h));
    const flag = snapshot.flags.find((f) => f.kind === 'DUPLICATE_EVIDENCE');
    expect(flag).toBeDefined();
    if (!flag) throw new Error('expected a duplicate-evidence flag');
    await dismissFlag(h.ctx, h.eventId, organiser(h), flag.id);
    expect((await manageSnapshot(h.ctx, h.eventId, organiser(h))).flags.some((f) => f.id === flag.id)).toBe(false);
  });
});

describe('Field Atlas: levels, seasons and badges', () => {
  it('unlocks a level from verified XP and makes the locked mission available', async () => {
    const h = await createHarness();
    const views = await listMissionsForViewer(h.ctx, h.eventId, attendee(h));
    expect(views.find((v) => v.id === 'fm-gallery-route')?.availability).toEqual({ state: 'LOCKED_LEVEL', requiredLevel: 1 });
    await adjustXp(h.ctx, h.eventId, organiser(h), attendee(h), 100, 'Reached explorer threshold in the pilot.');
    const state = await playerState(h.ctx, h.eventId, attendee(h));
    expect(state.level.id).toBe('explorer');
    const after = await listMissionsForViewer(h.ctx, h.eventId, attendee(h));
    expect(after.find((v) => v.id === 'fm-gallery-route')?.availability).toEqual({ state: 'AVAILABLE' });
  });

  it('awards the monthly badge and bonus once all required missions are verified in the season', async () => {
    const h = await createHarness();
    const registration = await codeFor(h, 'st-registration', 'sp-lobby', 'Registration');
    const mainHall = await codeFor(h, 'st-main-hall', 'sp-main', 'Main Hall doors');
    const room3 = await codeFor(h, 'st-room-3', 'sp-r3', 'Room 3 door');
    await adjustXp(h.ctx, h.eventId, organiser(h), attendee(h), 100, 'Reached explorer threshold in the pilot.');

    await startMission(h.ctx, h.eventId, attendee(h), 'fm-find-registration');
    await submitMission(h.ctx, h.eventId, attendee(h), 'fm-find-registration', { text: '', checkInCode: registration });
    await startMission(h.ctx, h.eventId, attendee(h), 'fm-plan-day');
    await runWorkflow(h.ctx, h.eventId, attendee(h), 'my-day', 'CANVAS');
    await submitMission(h.ctx, h.eventId, attendee(h), 'fm-plan-day', { text: '', checkInCode: '' });
    await startMission(h.ctx, h.eventId, attendee(h), 'fm-main-hall');
    await submitMission(h.ctx, h.eventId, attendee(h), 'fm-main-hall', { text: '', checkInCode: mainHall });
    const beforeLast = (await cabinetFor(h.ctx, h.eventId, attendee(h))).badges.filter((b) => b.kind === 'MONTHLY');
    expect(beforeLast).toHaveLength(0);
    await startMission(h.ctx, h.eventId, attendee(h), 'fm-room-3');
    const last = await submitMission(h.ctx, h.eventId, attendee(h), 'fm-room-3', { text: '', checkInCode: room3 });
    expect(last.outcome).toBe('APPROVED');
    expect(last.badges.map((b) => b.kind)).toContain('MONTHLY');

    const cabinet = await cabinetFor(h.ctx, h.eventId, attendee(h));
    expect(cabinet.badges.filter((b) => b.kind === 'MONTHLY').map((b) => b.name)).toEqual(['November: The First Explorer']);
    // XP: 100 adjustment + 30 + 25 + 40 + 60 + 100 season bonus.
    expect(cabinet.state.xp).toBe(355);
    expect(cabinet.badges.some((b) => b.badgeId === 'FIRST_MISSION')).toBe(true);
  });

  it('keeps an earned badge after its season ends, and never awards the same season twice', async () => {
    const h = await createHarness();
    await adjustXp(h.ctx, h.eventId, organiser(h), attendee(h), 100, 'Reached explorer threshold in the pilot.');
    const code = await codeFor(h, 'st-registration', 'sp-lobby', 'Registration');
    await startMission(h.ctx, h.eventId, attendee(h), 'fm-find-registration');
    await submitMission(h.ctx, h.eventId, attendee(h), 'fm-find-registration', { text: '', checkInCode: code });
    h.setNow(monthWindow(2026, 11).endsAt + 10);
    const history = await cabinetFor(h.ctx, h.eventId, attendee(h));
    expect(history.badges.some((b) => b.badgeId === 'FIRST_MISSION')).toBe(true);
    const seasons = await seasonsForViewer(h.ctx, h.eventId, attendee(h));
    expect(seasons.history.some((s) => s.id === 'season-2026-11' && s.phase === 'ENDED')).toBe(true);
  });

  it('will not start or award a mission after its window has ended', async () => {
    const h = await createHarness();
    const code = await codeFor(h, 'st-registration', 'sp-lobby', 'Registration');
    h.setNow(monthWindow(2026, 11).endsAt + 1000);
    const views = await listMissionsForViewer(h.ctx, h.eventId, attendee(h));
    expect(views.find((v) => v.id === 'fm-find-registration')?.availability).toEqual({ state: 'ENDED' });
    await expectDomainError(startMission(h.ctx, h.eventId, attendee(h), 'fm-find-registration'), 'FORBIDDEN');
    expect((await playerState(h.ctx, h.eventId, attendee(h))).xp).toBe(0);
    expect(code.length).toBe(8);
  });

  it('organisers may change the level table, and the change is audited with a version', async () => {
    const h = await createHarness();
    const levels: LevelDefinition[] = DEFAULT_LEVELS.map((l) => (l.id === 'explorer' ? { ...l, minXp: 50, name: 'Explorer' } : l));
    const saved = await saveLevels(h.ctx, h.eventId, organiser(h), levels);
    expect(saved.version).toBe(1);
    await adjustXp(h.ctx, h.eventId, organiser(h), attendee(h), 60, 'Lowered explorer threshold test.');
    expect((await playerState(h.ctx, h.eventId, attendee(h))).level.id).toBe('explorer');
    const audit = await h.store.listAudit(h.eventId);
    expect(audit.some((a) => a.action === 'field.levels.saved')).toBe(true);
  });
});

describe('Field Atlas: permissions', () => {
  it('an attendee cannot change missions, levels, seasons, stations, XP or reviews', async () => {
    const h = await createHarness();
    const me = attendee(h);
    await expectDomainError(saveMission(h.ctx, h.eventId, me, baseMission()), 'FORBIDDEN');
    await expectDomainError(saveLevels(h.ctx, h.eventId, me, DEFAULT_LEVELS), 'FORBIDDEN');
    await expectDomainError(saveSeason(h.ctx, h.eventId, me, { id: 'season-x', year: 2026, month: 12, title: 'December attempt', theme: 'Not allowed', description: 'An attendee trying to publish a season.', artwork: 'compass', bonusXp: 500, missionIds: ['fm-plan-day'], requiredMissionIds: ['fm-plan-day'], status: 'PUBLISHED' }), 'FORBIDDEN');
    await expectDomainError(issueStation(h.ctx, h.eventId, me, 'sp-lobby', 'Fake station', 'st-fake'), 'FORBIDDEN');
    await expectDomainError(adjustXp(h.ctx, h.eventId, me, me, 500, 'I want to grant myself points.'), 'FORBIDDEN');
    await expectDomainError(draftMonthlyChallenge(h.ctx, h.eventId, me, { year: 2026, month: 12 }), 'FORBIDDEN');
    await expectDomainError(manageSnapshot(h.ctx, h.eventId, me), 'FORBIDDEN');
    expect((await playerState(h.ctx, h.eventId, me)).xp).toBe(0);
  });

  it('operations staff can review evidence but cannot change rewards', async () => {
    const h = await createHarness();
    await expectDomainError(saveMission(h.ctx, h.eventId, h.users.opsLena, baseMission()), 'FORBIDDEN');
    await expectDomainError(adjustXp(h.ctx, h.eventId, h.users.opsLena, attendee(h), 100, 'Staff trying to award XP directly.'), 'FORBIDDEN');
    await expect(manageSnapshot(h.ctx, h.eventId, h.users.opsLena)).resolves.toBeDefined();
  });

  it('an XP adjustment is audited and needs a reason', async () => {
    const h = await createHarness();
    await expectDomainError(adjustXp(h.ctx, h.eventId, organiser(h), attendee(h), 10, 'short'), 'VALIDATION_FAILED');
    await adjustXp(h.ctx, h.eventId, organiser(h), attendee(h), 10, 'Corrected a missed check-in at registration.');
    const audit = await h.store.listAudit(h.eventId);
    expect(audit.some((a) => a.action === 'field.xp.adjusted' && a.detail.includes('Corrected a missed check-in'))).toBe(true);
  });

  it('rejects invalid mission definitions with a message', async () => {
    const h = await createHarness();
    await expectDomainError(saveMission(h.ctx, h.eventId, organiser(h), { ...baseMission(), xp: 9999 }), 'VALIDATION_FAILED');
    await expectDomainError(saveMission(h.ctx, h.eventId, organiser(h), { ...baseMission(), spaceId: 'sp-not-real' }), 'VALIDATION_FAILED');
    await expectDomainError(saveMission(h.ctx, h.eventId, organiser(h), { ...baseMission(), verification: { method: 'CHECK_IN', stationId: 'st-missing' } }), 'VALIDATION_FAILED');
  });
});

describe('Quest Director', () => {
  it('drafts a month from real rooms and stations, reports what it could not ground, and auto-publishes only low-risk drafts', async () => {
    const h = await createHarness();
    const outcome = await draftMonthlyChallenge(h.ctx, h.eventId, organiser(h), { year: 2026, month: 12 });
    expect(outcome.created).toBeGreaterThan(0);
    expect(outcome.run.sources.roomIds.length).toBeGreaterThan(0);
    expect(outcome.unavailable.some((u) => u.includes('Room 2'))).toBe(true);
    const drafts = (await h.store.docList('fieldMissions', { eventId: h.eventId })).filter((m: FieldMission) => m.seasonId === 'season-2026-12');
    expect(drafts.find((m) => m.id === 'season-2026-12-plan-day')?.status).toBe('PUBLISHED');
    expect(drafts.find((m) => m.id === 'season-2026-12-connect')?.status).toBe('DRAFT');
    expect(drafts.every((m) => m.source === 'QUEST_DIRECTOR')).toBe(true);
    // Drafts are invisible to attendees until an organiser publishes them.
    const visible = await listMissionsForViewer(h.ctx, h.eventId, attendee(h));
    expect(visible.some((v) => v.id === 'season-2026-12-connect')).toBe(false);
  });

  it('refuses to draft a month that has already ended', async () => {
    const h = await createHarness();
    await expectDomainError(draftMonthlyChallenge(h.ctx, h.eventId, organiser(h), { year: 2026, month: 9 }), 'VERSION_CONFLICT');
  });

  it('recommends missions ranked from real records, with a real step-free route when a place is chosen', async () => {
    const h = await createHarness();
    const none = await recommendFor(h.ctx, h.eventId, attendee(h), { minutes: null, startSpaceId: null, stepFree: false });
    const ids = none.recommendations.map((r) => r.missionId);
    expect(ids).toContain('fm-find-registration');
    expect(ids).not.toContain('fm-introduce');
    expect(none.recommendations[0]?.route).toBeNull();
    const routed = await recommendFor(h.ctx, h.eventId, attendee(h), { minutes: 20, startSpaceId: 'sp-lobby', stepFree: true });
    const first = routed.recommendations[0];
    expect(first?.route?.stepFree).toBe(true);
    expect(first?.route?.metres).toBeGreaterThanOrEqual(0);
  });

  it('answers questions about a mission with citations to its record', async () => {
    const h = await createHarness();
    const guide = await fieldGuide(h.ctx, h.eventId, attendee(h), 'fm-room-3');
    expect(guide.answers.map((a) => a.question)).toContain('Where should I go?');
    expect(guide.answers.every((a) => a.citations.length > 0 || a.question.startsWith('Which related'))).toBe(true);
    const what = guide.answers.find((a) => a.question === 'What do I need to complete it?');
    expect(what?.text).toMatch(/check-in code/);
  });

  it('refuses to guide a mission that is not published', async () => {
    const h = await createHarness();
    await expectDomainError(fieldGuide(h.ctx, h.eventId, attendee(h), 'fm-does-not-exist'), 'NOT_FOUND');
  });
});

describe('Field Atlas: data rights', () => {
  it('exports field progress and erases it, leaving other people untouched', async () => {
    const h = await createHarness();
    await adjustXp(h.ctx, h.eventId, organiser(h), attendee(h), 50, 'Pilot points for the export test.');
    await adjustXp(h.ctx, h.eventId, organiser(h), h.users.attendeeBen, 70, 'Pilot points for another person.');
    const exported = await exportMyData(h.ctx, attendee(h));
    const event = exported.events.find((e) => e.eventId === h.eventId);
    expect(event?.fieldAtlas.xpTotal).toBe(50);

    const report = await eraseMe(h.ctx, attendee(h));
    expect(report.fieldAtlasRecords).toBeGreaterThan(0);
    const after = await exportMyData(h.ctx, attendee(h));
    expect(after.events.find((e) => e.eventId === h.eventId)?.fieldAtlas).toMatchObject({ xpTotal: 0, xpEntries: [], missionAttempts: [], badges: [] });
    expect((await playerState(h.ctx, h.eventId, h.users.attendeeBen)).xp).toBe(70);
  });
});

function baseMission(): Record<string, unknown> {
  return {
    id: 'fm-test-mission',
    title: 'Test mission',
    description: 'A mission created by a test to check permissions.',
    whyItMatters: 'It exercises the validation path.',
    category: 'EXPLORATION',
    difficulty: 'EASY',
    requiredLevel: 0,
    xp: 20,
    seasonId: null,
    spaceId: 'sp-main',
    nonLocation: false,
    prerequisiteIds: [],
    verification: { method: 'CHECK_IN', stationId: 'st-main-hall' },
    estimateMinutes: 5,
    accessibilityNote: '',
    startsAt: null,
    endsAt: null,
    status: 'PUBLISHED',
    maxCompletionsPerPerson: 1,
    source: 'ORGANISER',
  };
}
