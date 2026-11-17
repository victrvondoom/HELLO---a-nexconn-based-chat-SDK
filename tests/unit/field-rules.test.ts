import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LEVELS,
  LevelsSchema,
  availability,
  achievementsEarned,
  decideVerification,
  levelFor,
  monthWindow,
  nextLevel,
  normaliseEvidence,
  seasonPhase,
  inWindow,
  MissionSchema,
  type LevelDefinition,
} from '@/domain/field/rules';

const none = new Set<string>();

function at(index: number) {
  const level = DEFAULT_LEVELS[index];
  if (!level) throw new Error(`no default level at ${index}`);
  return level;
}

describe('level progression', () => {
  it('reaches each level exactly at its minimum XP', () => {
    expect(levelFor(DEFAULT_LEVELS, 0, none).id).toBe('new-arrival');
    expect(levelFor(DEFAULT_LEVELS, 99, none).id).toBe('new-arrival');
    expect(levelFor(DEFAULT_LEVELS, 100, none).id).toBe('explorer');
    expect(levelFor(DEFAULT_LEVELS, 2500, none).id).toBe('master-coordinator');
    expect(levelFor(DEFAULT_LEVELS, 10_000, none).id).toBe('master-coordinator');
  });

  it('is deterministic regardless of the order levels are stored in', () => {
    const shuffled = [...DEFAULT_LEVELS].reverse();
    for (const xp of [0, 99, 100, 449, 450, 3000]) {
      expect(levelFor(shuffled, xp, none).id).toBe(levelFor(DEFAULT_LEVELS, xp, none).id);
    }
  });

  it('withholds a level whose required achievement is not held, without blocking lower levels', () => {
    const levels: LevelDefinition[] = [
      { ...at(0), requiredAchievements: [] },
      { ...at(1), minXp: 50, requiredAchievements: ['FIRST_MISSION'] },
      { ...at(2), minXp: 80, requiredAchievements: [] },
    ];
    expect(levelFor(levels, 60, none).id).toBe(at(0).id);
    expect(levelFor(levels, 60, new Set(['FIRST_MISSION'])).id).toBe(at(1).id);
    expect(levelFor(levels, 90, none).id).toBe(at(2).id);
  });

  it('ignores inactive levels and reports the next level and the XP still needed', () => {
    const levels = DEFAULT_LEVELS.map((l) => (l.id === 'explorer' ? { ...l, active: false } : l));
    expect(levelFor(levels, 150, none).id).toBe('new-arrival');
    const current = levelFor(DEFAULT_LEVELS, 180, none);
    expect(nextLevel(DEFAULT_LEVELS, current, 180)).toMatchObject({ level: { id: 'wayfinder' }, xpNeeded: 70 });
    expect(nextLevel(DEFAULT_LEVELS, levelFor(DEFAULT_LEVELS, 9000, none), 9000)).toBeNull();
  });

  it('validates level configuration', () => {
    expect(LevelsSchema.safeParse(DEFAULT_LEVELS).success).toBe(true);
    const noZero = DEFAULT_LEVELS.map((l) => ({ ...l, minXp: l.minXp + 5 }));
    expect(LevelsSchema.safeParse(noZero).success).toBe(false);
    const duplicate = [at(0), { ...at(1), id: at(0).id }];
    expect(LevelsSchema.safeParse(duplicate).success).toBe(false);
  });

  it('awards achievements from counts and level', () => {
    expect(achievementsEarned(0, 0)).toEqual([]);
    expect(achievementsEarned(1, 0)).toEqual(['FIRST_MISSION']);
    expect(achievementsEarned(5, 2)).toEqual(['FIRST_MISSION', 'FIVE_MISSIONS', 'WAYFINDER']);
  });
});

describe('monthly seasons', () => {
  it('uses UTC calendar months, including leap years', () => {
    const feb28 = monthWindow(2028, 2);
    expect(new Date(feb28.endsAt).toISOString()).toBe('2028-02-29T23:59:59.999Z');
    const nov = monthWindow(2026, 11);
    expect(new Date(nov.startsAt).toISOString()).toBe('2026-11-01T00:00:00.000Z');
    expect(new Date(nov.endsAt).toISOString()).toBe('2026-11-30T23:59:59.999Z');
  });

  it('keeps the boundaries exact: the last millisecond is active and the next is ended', () => {
    const w = monthWindow(2026, 11);
    expect(seasonPhase(w, w.startsAt - 1)).toBe('UPCOMING');
    expect(seasonPhase(w, w.startsAt)).toBe('ACTIVE');
    expect(seasonPhase(w, w.endsAt)).toBe('ACTIVE');
    expect(seasonPhase(w, w.endsAt + 1)).toBe('ENDED');
    expect(inWindow(w.endsAt, w)).toBe(true);
    expect(inWindow(w.endsAt + 1, w)).toBe(false);
  });

  it('rejects impossible months', () => {
    expect(() => monthWindow(2026, 13)).toThrow(RangeError);
    expect(() => monthWindow(2026, 0)).toThrow(RangeError);
  });
});

describe('mission availability', () => {
  const base = { id: 'm', requiredLevel: 1, prerequisiteIds: ['pre'], startsAt: null, endsAt: null, status: 'PUBLISHED' as const };
  it('explains each lock', () => {
    expect(availability(base, 0, 0, new Set(['pre']))).toEqual({ state: 'LOCKED_LEVEL', requiredLevel: 1 });
    expect(availability(base, 0, 1, none)).toEqual({ state: 'LOCKED_PREREQUISITE', missing: ['pre'] });
    expect(availability(base, 0, 1, new Set(['pre']))).toEqual({ state: 'AVAILABLE' });
  });
  it('respects draft, paused and time windows', () => {
    expect(availability({ ...base, status: 'DRAFT' }, 0, 9, new Set(['pre']))).toEqual({ state: 'DRAFT' });
    expect(availability({ ...base, status: 'PAUSED' }, 0, 9, new Set(['pre']))).toEqual({ state: 'PAUSED' });
    expect(availability({ ...base, startsAt: 100 }, 50, 9, new Set(['pre']))).toEqual({ state: 'NOT_YET' });
    expect(availability({ ...base, endsAt: 100 }, 150, 9, new Set(['pre']))).toEqual({ state: 'ENDED' });
  });
});

describe('verification policy', () => {
  const none = { matchingWorkflowRun: false, checkInValid: false, checkInExpired: false, evidenceText: '' };
  it('approves a workflow run only when a matching succeeded run exists', () => {
    expect(decideVerification({ ...none, method: 'WORKFLOW_RUN', matchingWorkflowRun: true }).outcome).toBe('APPROVE');
    expect(decideVerification({ ...none, method: 'WORKFLOW_RUN' }).outcome).toBe('NOT_VERIFIED');
  });
  it('never approves check-in without a valid, unexpired code, and says why', () => {
    expect(decideVerification({ ...none, method: 'CHECK_IN', checkInValid: true }).outcome).toBe('APPROVE');
    const expired = decideVerification({ ...none, method: 'CHECK_IN', checkInExpired: true });
    expect(expired).toMatchObject({ outcome: 'NOT_VERIFIED' });
    expect(expired.outcome === 'NOT_VERIFIED' && expired.reason).toMatch(/expired/);
    expect(decideVerification({ ...none, method: 'CHECK_IN' }).outcome).toBe('NOT_VERIFIED');
  });
  it('queues manual evidence for review and never approves it directly', () => {
    expect(decideVerification({ ...none, method: 'MANUAL_REVIEW', evidenceText: 'I walked the route.' }).outcome).toBe('PENDING_REVIEW');
    expect(decideVerification({ ...none, method: 'MANUAL_REVIEW', evidenceText: 'ok' }).outcome).toBe('NOT_VERIFIED');
  });
  it('normalises evidence so trivially altered copies compare equal', () => {
    expect(normaliseEvidence('  I walked,  the ROUTE!! ')).toBe(normaliseEvidence('i walked the route'));
  });
});

describe('mission definitions', () => {
  const valid = {
    id: 'fm-test-one',
    title: 'A test mission',
    description: 'Something a person can actually do here.',
    whyItMatters: 'It matters for a test.',
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
  it('accepts a valid mission', () => {
    expect(MissionSchema.safeParse(valid).success).toBe(true);
  });
  it('requires a location or an explicit non-location flag', () => {
    expect(MissionSchema.safeParse({ ...valid, spaceId: null }).success).toBe(false);
    expect(MissionSchema.safeParse({ ...valid, spaceId: null, nonLocation: true }).success).toBe(true);
  });
  it('caps XP and forbids a mission that requires itself', () => {
    expect(MissionSchema.safeParse({ ...valid, xp: 501 }).success).toBe(false);
    expect(MissionSchema.safeParse({ ...valid, prerequisiteIds: ['fm-test-one'] }).success).toBe(false);
  });
  it('fixes repeat completions at one', () => {
    expect(MissionSchema.safeParse({ ...valid, maxCompletionsPerPerson: 2 }).success).toBe(false);
  });
});
