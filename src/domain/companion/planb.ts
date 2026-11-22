import type { Room, Session } from '../types';

/**
 * Capy: Plan B. When a session is full or gone, rank the alternatives a person could still reach, with
 * reasons. Hard filters first (never broken), then a weighted score. Pure: the caller supplies walking
 * times from the venue graph and live seat counts from the seat ledger.
 */
export const PLAN_B_WINDOW_MS = 90 * 60_000;
export const PLAN_B_WEIGHTS = { topic: 0.4, soon: 0.2, seats: 0.2, walk: 0.2 } as const;

export interface PlanBInput {
  now: number;
  sessions: Session[];
  rooms: Room[];
  /** Topics the person cares about: from their plan's sessions and the session they could not attend. */
  topics: string[];
  /** Sessions already in the person's plan (their times are commitments). */
  planned: Session[];
  /** The session being replaced, excluded from the results. */
  replacing: string | null;
  stepFree: boolean;
  /** Seats really available now: capacity - enrolled - active holds. Missing: unknown, so excluded. */
  seats: Record<string, number>;
  /** Walking minutes from where the person is, by room id. Missing: no known route, so excluded. */
  walkMinutes: Record<string, number>;
  /** Rooms closed or marked full by staff. */
  closedSessions: ReadonlySet<string>;
}

export interface PlanBOption {
  sessionId: string;
  title: string;
  roomId: string;
  roomName: string;
  startsAt: number;
  seats: number;
  walkMinutes: number;
  score: number;
  reasons: string[];
}

export type PlanBExclusion = { sessionId: string; reason: 'ENDED' | 'TOO_LATE' | 'NO_SEATS' | 'CLOSED' | 'NOT_STEP_FREE' | 'CLASH' | 'NO_ROUTE' | 'REPLACED' | 'UNREACHABLE_IN_TIME' };

const norm = (t: string) => t.toLowerCase();

export function rankPlanB(input: PlanBInput): { options: PlanBOption[]; excluded: PlanBExclusion[] } {
  const rooms = new Map(input.rooms.map((r) => [r.id, r] as const));
  const wanted = new Set(input.topics.map(norm));
  const options: PlanBOption[] = [];
  const excluded: PlanBExclusion[] = [];
  for (const s of input.sessions) {
    const room = rooms.get(s.roomId);
    const exclude = (reason: PlanBExclusion['reason']) => excluded.push({ sessionId: s.id, reason });
    if (s.id === input.replacing) { exclude('REPLACED'); continue; }
    if (s.endsAt <= input.now) { exclude('ENDED'); continue; }
    if (s.startsAt > input.now + PLAN_B_WINDOW_MS) { exclude('TOO_LATE'); continue; }
    if (input.closedSessions.has(s.id)) { exclude('CLOSED'); continue; }
    const seats = input.seats[s.id];
    if (seats === undefined || seats <= 0) { exclude('NO_SEATS'); continue; }
    if (input.stepFree && (!s.accessible || !room?.accessible)) { exclude('NOT_STEP_FREE'); continue; }
    if (input.planned.some((p) => p.id !== input.replacing && p.id !== s.id && p.startsAt < s.endsAt && s.startsAt < p.endsAt)) { exclude('CLASH'); continue; }
    const walk = input.walkMinutes[s.roomId];
    if (walk === undefined || !room) { exclude('NO_ROUTE'); continue; }
    // Already running: only worth it if you would arrive within its first 15 minutes.
    if (s.startsAt < input.now && input.now + walk * 60_000 > s.startsAt + 15 * 60_000) { exclude('UNREACHABLE_IN_TIME'); continue; }

    const shared = s.topics.filter((t) => wanted.has(norm(t)));
    const topic = wanted.size === 0 ? 0.5 : shared.length / Math.max(1, Math.min(wanted.size, s.topics.length));
    const minutesAway = Math.max(0, (s.startsAt - input.now) / 60_000);
    const soon = 1 - Math.min(1, minutesAway / 90);
    const seatScore = Math.min(1, seats / 20);
    const walkScore = 1 - Math.min(1, walk / 15);
    const score = Math.round((PLAN_B_WEIGHTS.topic * Math.min(1, topic) + PLAN_B_WEIGHTS.soon * soon + PLAN_B_WEIGHTS.seats * seatScore + PLAN_B_WEIGHTS.walk * walkScore) * 1000) / 1000;
    const reasons = [
      shared.length > 0 ? `Shares ${shared.join(', ')}` : 'A different topic',
      s.startsAt <= input.now ? 'Started just now' : `Starts in ${Math.round(minutesAway)} min`,
      `${Math.max(1, Math.round(walk))} min walk${input.stepFree ? ', step-free' : ''}`,
      `${seats} verified ${seats === 1 ? 'seat' : 'seats'} free`,
    ];
    options.push({ sessionId: s.id, title: s.title, roomId: s.roomId, roomName: room.name, startsAt: s.startsAt, seats, walkMinutes: walk, score, reasons });
  }
  options.sort((a, b) => b.score - a.score || a.startsAt - b.startsAt || (a.sessionId < b.sessionId ? -1 : 1));
  return { options, excluded };
}

/** Free seats once active holds are counted. Never negative. */
export function freeSeats(session: Pick<Session, 'capacity' | 'enrolled'>, holds: Record<string, number>, now: number): number {
  const active = Object.values(holds).filter((until) => until > now).length;
  return Math.max(0, session.capacity - session.enrolled - active);
}
