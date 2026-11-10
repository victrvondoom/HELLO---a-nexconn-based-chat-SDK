import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ASSIGNMENT_WEIGHTS,
  MAX_OPEN_ASSIGNMENTS,
  rankAssignees,
  validateWeights,
  type AssignmentCandidateInput,
} from '@/domain/assignments/scoring';
import {
  DEFAULT_SESSION_WEIGHTS,
  recommendSessions,
  validateSessionWeights,
  type RecommendationInput,
} from '@/domain/sessions/recommend';
import type { Membership, Room, Session } from '@/domain/types';

function staff(
  userId: string,
  overrides: Partial<Membership> = {},
): AssignmentCandidateInput {
  return {
    membership: {
      id: `m-${userId}`,
      eventId: 'evt',
      userId,
      role: 'OPERATIONS_STAFF',
      skills: ['AV'],
      availability: 'AVAILABLE',
      zone: 'Workshop',
      ...overrides,
    },
    displayName: userId,
    openAssignments: 0,
  };
}

describe('assignment scoring', () => {
  it('ranks a skilled, available staff member in the incident zone first', () => {
    const ranking = rankAssignees({ category: 'AV', zone: 'Workshop' }, [
      staff('far', { zone: 'Main' }),
      staff('near'),
    ]);
    expect(ranking.eligible.map((c) => c.userId)).toEqual(['near', 'far']);
    expect(ranking.eligible[0]?.components.location).toBe(1);
    expect(ranking.eligible[0]?.reasons).toContain('Has AV skill.');
  });

  it('excludes people off shift, over their limit, or without the required skill', () => {
    const ranking = rankAssignees({ category: 'AV', zone: null }, [
      staff('off', { availability: 'OFF_SHIFT' }),
      staff('available'),
      staff('noskill', { skills: ['FACILITIES'] }),
      staff('volunteer', { role: 'VOLUNTEER', skills: ['STEWARDING'] }),
      staff('attendee', { role: 'ATTENDEE' }),
    ]);
    const reasons = Object.fromEntries(ranking.ineligible.map((i) => [i.userId, i.reason]));
    expect(reasons.off).toBe('Off shift.');
    expect(reasons.noskill).toBe('No AV skill recorded.');
    expect(reasons.volunteer).toBe('No AV skill recorded.');
    expect(reasons.attendee).toBe('Not operational staff.');
    expect(ranking.eligible.map((c) => c.userId)).toEqual(['available']);
  });

  it('refuses people already at the open-assignment limit', () => {
    const ranking = rankAssignees({ category: 'AV', zone: null }, [
      { ...staff('full'), openAssignments: MAX_OPEN_ASSIGNMENTS },
    ]);
    expect(ranking.eligible).toHaveLength(0);
    expect(ranking.ineligible[0]?.reason).toContain('limit');
  });

  it('never recommends an organiser as the person doing technical work', () => {
    const ranking = rankAssignees({ category: 'AV', zone: null }, [
      staff('nadia', { role: 'ORGANISER', skills: [] }),
    ]);
    expect(ranking.eligible).toHaveLength(0);
    expect(ranking.ineligible[0]?.reason).toBe('No AV skill recorded.');
  });

  it('allows generalists at reduced skill weight', () => {
    const ranking = rankAssignees({ category: 'FACILITIES', zone: null }, [staff('gen', { skills: ['GENERAL'] })]);
    expect(ranking.eligible[0]?.components.skill).toBe(0.5);
  });

  it('rejects scoring weights that do not sum to one', () => {
    expect(() => { validateWeights({ ...DEFAULT_ASSIGNMENT_WEIGHTS, skill: 0.9 }); }).toThrow(/sum to 1/);
    expect(() => { validateWeights({ ...DEFAULT_ASSIGNMENT_WEIGHTS, skill: -0.1, workload: 0.35 }); }).toThrow();
  });

  it('lets configured weights change the order', () => {
    const candidates = [
      staff('skilled', { zone: 'Main' }),
      { ...staff('loaded', { zone: 'Workshop' }), openAssignments: 2 },
    ];
    const byLocation = rankAssignees({ category: 'AV', zone: 'Workshop' }, candidates, {
      skill: 0,
      workload: 0,
      availability: 0,
      location: 1,
    });
    expect(byLocation.eligible[0]?.userId).toBe('loaded');
  });
});

const rooms: Room[] = [
  { id: 'r-a', eventId: 'evt', name: 'Room A', zone: 'Main', capacity: 100, accessible: true, equipment: [], occupancy: null, occupancySource: null },
  { id: 'r-b', eventId: 'evt', name: 'Room B', zone: 'Workshop', capacity: 50, accessible: false, equipment: [], occupancy: null, occupancySource: null },
];

function session(overrides: Partial<Session> & Pick<Session, 'id'>): Session {
  return {
    eventId: 'evt',
    title: overrides.id,
    topics: [],
    roomId: 'r-a',
    startsAt: Date.UTC(2026, 10, 10, 14),
    endsAt: Date.UTC(2026, 10, 10, 15),
    capacity: 100,
    enrolled: 10,
    accessible: true,
    speakerUserId: null,
    ...overrides,
  };
}

function input(overrides: Partial<RecommendationInput> = {}): RecommendationInput {
  return {
    user: { interests: ['robotics'], accessibilityRequired: false },
    sessions: [],
    rooms,
    plannedSessions: [],
    currentSessionId: null,
    fromZone: 'Main',
    walkMinutes: (from, to) => (from === to ? 2 : 6),
    ...overrides,
  };
}

describe('session recommendation', () => {
  it('never recommends a full session', () => {
    const result = recommendSessions(
      input({ sessions: [session({ id: 'full', enrolled: 100, topics: ['robotics'] })] }),
    );
    expect(result.recommendations).toHaveLength(0);
    expect(result.excluded).toEqual([expect.objectContaining({ sessionId: 'full', reason: 'FULL' })]);
  });

  it('excludes inaccessible sessions when the person needs accessibility', () => {
    const result = recommendSessions(
      input({
        user: { interests: [], accessibilityRequired: true },
        sessions: [session({ id: 'stairs', roomId: 'r-b', accessible: false })],
      }),
    );
    expect(result.excluded[0]?.reason).toBe('INACCESSIBLE');
  });

  it('excludes the current session and sessions that overlap the planned schedule', () => {
    const current = session({ id: 'now' });
    const planned = session({ id: 'planned', startsAt: Date.UTC(2026, 10, 10, 14, 30), endsAt: Date.UTC(2026, 10, 10, 15, 30) });
    const clash = session({ id: 'clash', startsAt: Date.UTC(2026, 10, 10, 14, 45), endsAt: Date.UTC(2026, 10, 10, 15, 15) });
    const result = recommendSessions(
      input({ sessions: [current, planned, clash], plannedSessions: [planned], currentSessionId: 'now' }),
    );
    const reasons = Object.fromEntries(result.excluded.map((e) => [e.sessionId, e.reason]));
    expect(reasons.now).toBe('CURRENT_SESSION');
    expect(reasons.clash).toBe('SCHEDULE_CONFLICT');
  });

  it('never offers a session that has already ended', () => {
    const over = session({ id: 'over', topics: ['robotics'], startsAt: Date.UTC(2026, 10, 10, 9), endsAt: Date.UTC(2026, 10, 10, 10) });
    const later = session({ id: 'later', topics: ['robotics'] });
    const result = recommendSessions(input({ sessions: [over, later], now: Date.UTC(2026, 10, 10, 12) }));
    expect(result.recommendations.map((r) => r.sessionId)).toEqual(['later']);
    expect(result.excluded).toEqual([expect.objectContaining({ sessionId: 'over', reason: 'ENDED' })]);
  });

  it('ranks topic relevance above an otherwise similar session', () => {
    const relevant = session({ id: 'robotics', topics: ['Robotics'] });
    const unrelated = session({ id: 'finance', topics: ['finance'] });
    const result = recommendSessions(input({ sessions: [unrelated, relevant] }));
    expect(result.recommendations[0]?.sessionId).toBe('robotics');
    expect(result.recommendations[0]?.reasons[0]).toContain('Matches your interests');
  });

  it('explains free seats and walking distance for each recommendation', () => {
    const result = recommendSessions(input({ sessions: [session({ id: 'x', capacity: 100, enrolled: 60 })] }));
    expect(result.recommendations[0]?.reasons).toEqual(
      expect.arrayContaining(['40 of 100 seats free.', 'About 2 minute walk from your current location.']),
    );
  });

  it('validates that session weights sum to one', () => {
    expect(() => { validateSessionWeights({ ...DEFAULT_SESSION_WEIGHTS, topic: 0.5 }); }).toThrow(/sum to 1/);
  });
});
