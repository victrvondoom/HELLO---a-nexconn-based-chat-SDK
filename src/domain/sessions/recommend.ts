import type { Room, Session, User } from '../types';

/**
 * Capacity-aware alternative session recommendation.
 *
 * Hard exclusions come first: a full session, an inaccessible session for someone
 * who needs accessibility, a session the person is already in, or one that
 * clashes with their planned schedule are never recommended. The remaining
 * sessions are scored with configurable weights. Each score is reported with
 * its components so the recommendation can explain itself.
 */

export interface SessionWeights {
  topic: number;
  schedule: number;
  capacity: number;
  distance: number;
  preference: number;
}

export const DEFAULT_SESSION_WEIGHTS: SessionWeights = {
  topic: 0.35,
  schedule: 0.25,
  capacity: 0.2,
  distance: 0.1,
  preference: 0.1,
};

/** Minimum gap between back-to-back sessions before a transition is considered tight. */
export const TIGHT_TRANSITION_MS = 15 * 60 * 1000;
export const WALK_MINUTES_FOR_FULL_SCORE = 15;

export function validateSessionWeights(weights: SessionWeights): void {
  const values: number[] = [weights.topic, weights.schedule, weights.capacity, weights.distance, weights.preference];
  if (values.some((v) => !Number.isFinite(v) || v < 0)) {
    throw new Error('Session weights must be finite and non-negative.');
  }
  const total = values.reduce((s, v) => s + v, 0);
  if (Math.abs(total - 1) > 1e-9) {
    throw new Error(`Session weights must sum to 1 (received ${total.toFixed(4)}).`);
  }
}

export type ExclusionReason =
  | 'ENDED'
  | 'CURRENT_SESSION'
  | 'FULL'
  | 'INACCESSIBLE'
  | 'SCHEDULE_CONFLICT'
  | 'ROOM_UNKNOWN';

export interface SessionRecommendation {
  sessionId: string;
  title: string;
  roomId: string;
  roomName: string;
  startsAt: number;
  total: number;
  components: { topic: number; schedule: number; capacity: number; distance: number; preference: number };
  reasons: string[];
}

export interface RecommendationInput {
  user: Pick<User, 'interests' | 'accessibilityRequired'>;
  sessions: readonly Session[];
  rooms: readonly Room[];
  /** Sessions the person already plans to attend. */
  plannedSessions: readonly Session[];
  currentSessionId: string | null;
  /** Current time in ms. Sessions that have already ended are never offered. 0 disables the check. */
  now?: number;
  /** Zone the person is currently in. Null if unknown. */
  fromZone: string | null;
  /** Walking minutes between two zones. Returns null when the route is unknown. */
  walkMinutes: (fromZone: string, toZone: string) => number | null;
  maxResults?: number;
}

export interface RecommendationResult {
  recommendations: SessionRecommendation[];
  excluded: Array<{ sessionId: string; title: string; reason: ExclusionReason }>;
}

function jaccard(a: readonly string[], b: readonly string[]): number {
  const left = new Set(a.map((x) => x.toLowerCase()));
  const right = new Set(b.map((x) => x.toLowerCase()));
  if (left.size === 0 || right.size === 0) {
    return 0;
  }
  let shared = 0;
  for (const token of left) {
    if (right.has(token)) {
      shared += 1;
    }
  }
  return shared / (left.size + right.size - shared);
}

function overlapsOrTight(a: Session, b: Session): 'OVERLAP' | 'TIGHT' | 'NONE' {
  if (a.startsAt < b.endsAt && b.startsAt < a.endsAt) {
    return 'OVERLAP';
  }
  const gap = a.startsAt >= b.endsAt ? a.startsAt - b.endsAt : b.startsAt - a.endsAt;
  return gap < TIGHT_TRANSITION_MS ? 'TIGHT' : 'NONE';
}

export function recommendSessions(
  input: RecommendationInput,
  weights: SessionWeights = DEFAULT_SESSION_WEIGHTS,
): RecommendationResult {
  validateSessionWeights(weights);
  const roomById = new Map(input.rooms.map((r) => [r.id, r] as const));
  const excluded: RecommendationResult['excluded'] = [];
  const recommendations: SessionRecommendation[] = [];

  for (const session of input.sessions) {
    const room = roomById.get(session.roomId);
    if (input.now !== undefined && session.endsAt <= input.now) {
      excluded.push({ sessionId: session.id, title: session.title, reason: 'ENDED' });
      continue;
    }
    if (session.id === input.currentSessionId) {
      excluded.push({ sessionId: session.id, title: session.title, reason: 'CURRENT_SESSION' });
      continue;
    }
    if (!room) {
      excluded.push({ sessionId: session.id, title: session.title, reason: 'ROOM_UNKNOWN' });
      continue;
    }
    if (session.capacity <= 0 || session.enrolled >= session.capacity) {
      excluded.push({ sessionId: session.id, title: session.title, reason: 'FULL' });
      continue;
    }
    if (input.user.accessibilityRequired && (!session.accessible || !room.accessible)) {
      excluded.push({ sessionId: session.id, title: session.title, reason: 'INACCESSIBLE' });
      continue;
    }
    const clash = input.plannedSessions.some((planned) => {
      if (planned.id === session.id) {
        return false;
      }
      return overlapsOrTight(planned, session) === 'OVERLAP';
    });
    if (clash) {
      excluded.push({ sessionId: session.id, title: session.title, reason: 'SCHEDULE_CONFLICT' });
      continue;
    }

    const topicScore = input.user.interests.length === 0 ? 0.5 : jaccard(input.user.interests, session.topics);

    const tight = input.plannedSessions.some(
      (planned) => planned.id !== session.id && overlapsOrTight(planned, session) === 'TIGHT',
    );
    const scheduleScore = tight ? 0.5 : 1;

    const freeSeatRatio = Math.max(0, Math.min(1, (session.capacity - session.enrolled) / session.capacity));

    let distanceScore = 0.5;
    let walkMinutes: number | null = null;
    if (input.fromZone !== null) {
      walkMinutes = input.walkMinutes(input.fromZone, room.zone);
      if (walkMinutes !== null) {
        distanceScore = Math.max(0, 1 - walkMinutes / WALK_MINUTES_FOR_FULL_SCORE);
      }
    }

    // Accessibility is enforced as a hard filter above, so every remaining candidate satisfies it.
    // Other personal preferences are not modelled yet and therefore do not change the ranking.
    const preferenceScore = 1;

    const components = {
      topic: topicScore,
      schedule: scheduleScore,
      capacity: freeSeatRatio,
      distance: distanceScore,
      preference: preferenceScore,
    };
    const total =
      weights.topic * components.topic +
      weights.schedule * components.schedule +
      weights.capacity * components.capacity +
      weights.distance * components.distance +
      weights.preference * components.preference;

    const reasons: string[] = [];
    if (input.user.interests.length > 0) {
      const shared = session.topics.filter((t) => input.user.interests.some((i) => i.toLowerCase() === t.toLowerCase()));
      reasons.push(
        shared.length > 0 ? `Matches your interests: ${shared.join(', ')}.` : 'Outside your declared interests.',
      );
    }
    reasons.push(`${session.capacity - session.enrolled} of ${session.capacity} seats free.`);
    if (tight) {
      reasons.push('Starts within 15 minutes of another session you plan to attend.');
    }
    if (walkMinutes !== null) {
      reasons.push(`About ${walkMinutes} minute walk from your current location.`);
    }
    if (input.user.accessibilityRequired) {
      reasons.push('Verified accessible room and session.');
    }

    recommendations.push({
      sessionId: session.id,
      title: session.title,
      roomId: room.id,
      roomName: room.name,
      startsAt: session.startsAt,
      total: Math.round(total * 1000) / 1000,
      components,
      reasons,
    });
  }

  recommendations.sort((a, b) => b.total - a.total || a.startsAt - b.startsAt || a.sessionId.localeCompare(b.sessionId));
  return {
    recommendations: recommendations.slice(0, input.maxResults ?? 3),
    excluded,
  };
}
