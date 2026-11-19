import { describe, expect, it } from 'vitest';
import {
  conditionPenalty,
  crowdLevel,
  incidentLevel,
  pulsePenalty,
  seasonPulse,
  spaceCondition,
  suppress,
  worstLevel,
  PULSE_MIN_COUNT,
  PULSE_WINDOW_MS,
  type PulseAttempt,
} from '@/domain/field/live';

const NOW = Date.UTC(2026, 10, 14, 10, 0);
const MIN = 60_000;

describe('field conditions', () => {
  it('takes the worst level of all signals', () => {
    expect(worstLevel([])).toBe('CLEAR');
    expect(worstLevel(['BUSY', 'AVOID', 'CAUTION'])).toBe('AVOID');
  });

  it('asks people to wait for urgent crowding and access issues only', () => {
    expect(incidentLevel({ category: 'CAPACITY', urgency: 'HIGH' })).toBe('AVOID');
    expect(incidentLevel({ category: 'CAPACITY', urgency: 'LOW' })).toBe('CAUTION');
    expect(incidentLevel({ category: 'ACCESSIBILITY', urgency: 'CRITICAL' })).toBe('AVOID');
    expect(incidentLevel({ category: 'AV', urgency: 'MEDIUM' })).toBe('BUSY');
    expect(incidentLevel({ category: 'FACILITIES', urgency: 'CRITICAL' })).toBe('AVOID');
  });

  it('reads crowding from occupancy and capacity, and says nothing without a figure', () => {
    expect(crowdLevel({ capacity: 40, occupancy: null, occupancySource: null })).toBeNull();
    expect(crowdLevel({ capacity: 0, occupancy: 10, occupancySource: 'ADMIN_ENTERED' })).toBeNull();
    expect(crowdLevel({ capacity: 100, occupancy: 79, occupancySource: 'ADMIN_ENTERED' })?.level).toBe('CLEAR');
    expect(crowdLevel({ capacity: 100, occupancy: 80, occupancySource: 'ADMIN_ENTERED' })?.level).toBe('BUSY');
    expect(crowdLevel({ capacity: 40, occupancy: 52, occupancySource: 'DEMO_SEED' })?.level).toBe('AVOID');
  });

  it('reduces incidents to a category and a count, never their text', () => {
    const c = spaceCondition('sp-r3', {
      incidents: [
        { category: 'AV', urgency: 'MEDIUM' },
        { category: 'AV', urgency: 'LOW' },
      ],
      room: null,
      sessions: [],
      now: NOW,
    });
    expect(c.level).toBe('BUSY');
    expect(c.signals).toHaveLength(1);
    expect(c.signals[0]).toMatchObject({ kind: 'INCIDENT', category: 'AV', count: 2 });
    expect(c.signals[0]?.text).toBe('Staff are handling 2 reported audio-visual issues here.');
  });

  it('marks a running session, and ignores sessions that are over or not started', () => {
    const sessions = [
      { id: 's-past', title: 'Past', startsAt: NOW - 90 * MIN, endsAt: NOW - 30 * MIN },
      { id: 's-now', title: 'Workshop', startsAt: NOW - 10 * MIN, endsAt: NOW + 50 * MIN },
      { id: 's-next', title: 'Later', startsAt: NOW + 60 * MIN, endsAt: NOW + 120 * MIN },
    ];
    const c = spaceCondition('sp-r4', { incidents: [], room: null, sessions, now: NOW });
    expect(c.signals.map((s) => s.kind)).toEqual(['SESSION']);
    expect(c.signals[0]).toMatchObject({ sessionId: 's-now' });
    expect(spaceCondition('sp-r4', { incidents: [], room: null, sessions: sessions.filter((x) => x.id !== 's-now'), now: NOW }).signals).toEqual([]);
  });

  it('flags an access issue so a step-free search can steer away from it', () => {
    const c = spaceCondition('sp-r2', { incidents: [{ category: 'ACCESSIBILITY', urgency: 'LOW' }], room: null, sessions: [], now: NOW });
    expect(c.accessIssue).toBe(true);
    expect(conditionPenalty(c, false)).toBe(-2);
    expect(conditionPenalty(c, true)).toBe(-6);
    expect(conditionPenalty(undefined, true)).toBe(0);
  });
});

describe('season pulse', () => {
  const attempt = (userId: string, missionId: string, status: PulseAttempt['status'], minutesAgo: number): PulseAttempt => ({
    missionId,
    userId,
    status,
    startedAt: NOW - (minutesAgo + 5) * MIN,
    approvedAt: status === 'APPROVED' ? NOW - minutesAgo * MIN : null,
  });

  it('suppresses any count below the minimum, so one person cannot be singled out', () => {
    expect(PULSE_MIN_COUNT).toBe(3);
    expect(suppress(0)).toBeNull();
    expect(suppress(2)).toBeNull();
    expect(suppress(3)).toBe(3);
  });

  it('counts people, not attempts, inside the window only', () => {
    const attempts = [
      attempt('u1', 'm1', 'APPROVED', 5),
      attempt('u2', 'm1', 'APPROVED', 20),
      attempt('u3', 'm1', 'APPROVED', 50),
      attempt('u4', 'm1', 'APPROVED', 90), // outside the hour
      attempt('u5', 'm2', 'APPROVED', 5),
    ];
    const p = seasonPulse({ seasonId: 's', seasonMissionIds: ['m1', 'm2'], missionIds: ['m1', 'm2'], attempts, badgeHolders: 1, now: NOW });
    expect(p.missions.find((m) => m.missionId === 'm1')).toEqual({ missionId: 'm1', verifiedLastHour: 3, underwayNow: null, completedTotal: 4 });
    expect(p.missions.find((m) => m.missionId === 'm2')).toEqual({ missionId: 'm2', verifiedLastHour: null, underwayNow: null, completedTotal: null });
    expect(p.participants).toBe(5);
    expect(p.badgesEarned).toBeNull();
    expect(p.windowMinutes).toBe(PULSE_WINDOW_MS / MIN);
  });

  it('reports no season figures when no season is running', () => {
    const p = seasonPulse({ seasonId: null, seasonMissionIds: [], missionIds: ['m1'], attempts: [], badgeHolders: 9, now: NOW });
    expect(p.participants).toBeNull();
    expect(p.badgesEarned).toBeNull();
  });

  it('boosts missions that verified recently and spreads people out of busy places', () => {
    const busy = spaceCondition('x', { incidents: [], room: { capacity: 10, occupancy: 9, occupancySource: 'ADMIN_ENTERED' }, sessions: [], now: NOW });
    expect(pulsePenalty({ missionId: 'm', verifiedLastHour: 4, underwayNow: null, completedTotal: 4 }, undefined)).toBe(0.5);
    expect(pulsePenalty({ missionId: 'm', verifiedLastHour: 4, underwayNow: 5, completedTotal: 4 }, busy)).toBe(-0.5);
    expect(pulsePenalty(undefined, busy)).toBe(0);
  });
});
