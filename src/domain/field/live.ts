/**
 * HELLO Field Atlas: live field conditions and the season pulse. Pure rules, no storage, no clock.
 *
 * Field conditions join four modules that used to be separate: open incidents (src/services/incidents.ts),
 * room occupancy, the session schedule and the venue map. They describe each place right now, so the map,
 * the mission panel and Quest Director's ranking all react when an incident opens or a room fills up.
 *
 * The season pulse shows momentum ("12 people verified this in the last hour") without a leaderboard.
 * Every count is aggregate, and counts below PULSE_MIN_COUNT are suppressed, so a pulse can never single
 * out one person (for example the only person who completed a mission).
 */

import type { DataSource, IncidentCategory, Urgency } from '../types';

export type ConditionLevel = 'CLEAR' | 'BUSY' | 'CAUTION' | 'AVOID';

const LEVEL_RANK: Record<ConditionLevel, number> = { CLEAR: 0, BUSY: 1, CAUTION: 2, AVOID: 3 };

export function worstLevel(levels: ConditionLevel[]): ConditionLevel {
  return levels.reduce<ConditionLevel>((worst, l) => (LEVEL_RANK[l] > LEVEL_RANK[worst] ? l : worst), 'CLEAR');
}

/** Occupancy at or above this share of capacity is "busy". */
export const BUSY_RATIO = 0.8;
/** Occupancy at or above capacity: people are asked to go elsewhere for now. */
export const FULL_RATIO = 1;

export interface ConditionIncident {
  category: IncidentCategory;
  urgency: Urgency;
  /** Only open incidents are passed in. */
}

export interface ConditionRoom {
  capacity: number;
  occupancy: number | null;
  occupancySource: DataSource | null;
}

export interface ConditionSession {
  id: string;
  title: string;
  startsAt: number;
  endsAt: number;
}

export type ConditionSignal =
  | { kind: 'INCIDENT'; level: ConditionLevel; category: IncidentCategory; count: number; text: string }
  | { kind: 'CROWD'; level: ConditionLevel; ratio: number; source: DataSource | null; text: string }
  | { kind: 'SESSION'; level: ConditionLevel; sessionId: string; endsAt: number; text: string };

export interface SpaceCondition {
  spaceId: string;
  level: ConditionLevel;
  /** True when an open accessibility incident is reported here: step-free routes may be affected. */
  accessIssue: boolean;
  signals: ConditionSignal[];
}

const CATEGORY_WORD: Record<IncidentCategory, string> = {
  AV: 'audio-visual',
  CAPACITY: 'crowding',
  ACCESSIBILITY: 'access',
  FACILITIES: 'facilities',
  SCHEDULE: 'schedule',
  GENERAL: 'general',
};

/** How an open incident affects visitors. Crowding, access and urgent facilities issues ask people to wait. */
export function incidentLevel(incident: ConditionIncident): ConditionLevel {
  const urgent = incident.urgency === 'HIGH' || incident.urgency === 'CRITICAL';
  if (incident.category === 'CAPACITY' && urgent) return 'AVOID';
  if (incident.category === 'ACCESSIBILITY' && urgent) return 'AVOID';
  if (incident.category === 'FACILITIES' && incident.urgency === 'CRITICAL') return 'AVOID';
  if (incident.category === 'SCHEDULE' || incident.category === 'AV') return urgent ? 'CAUTION' : 'BUSY';
  return 'CAUTION';
}

export function crowdLevel(room: ConditionRoom): { level: ConditionLevel; ratio: number } | null {
  if (room.occupancy === null || room.capacity <= 0) return null;
  const ratio = room.occupancy / room.capacity;
  if (ratio >= FULL_RATIO) return { level: 'AVOID', ratio };
  if (ratio >= BUSY_RATIO) return { level: 'BUSY', ratio };
  return { level: 'CLEAR', ratio };
}

const SOURCE_WORD: Record<DataSource, string> = {
  LIVE_VERIFIED: 'verified count',
  ADMIN_ENTERED: 'staff count',
  REPORTED_BY_ATTENDEES: 'reported by attendees',
  DEMO_SEED: 'demo figure',
};

const clock = (ms: number) => new Date(ms).toISOString().slice(11, 16);

/**
 * The condition of one place right now. Incident details are reduced to a category and a count: an
 * attendee learns that staff are handling something, never what someone reported.
 */
export function spaceCondition(
  spaceId: string,
  input: { incidents: ConditionIncident[]; room: ConditionRoom | null; sessions: ConditionSession[]; now: number },
): SpaceCondition {
  const signals: ConditionSignal[] = [];
  const byCategory = new Map<IncidentCategory, ConditionIncident[]>();
  for (const i of input.incidents) byCategory.set(i.category, [...(byCategory.get(i.category) ?? []), i]);
  for (const [category, list] of [...byCategory.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const level = worstLevel(list.map(incidentLevel));
    signals.push({
      kind: 'INCIDENT',
      level,
      category,
      count: list.length,
      text: `Staff are handling ${list.length === 1 ? 'a reported' : `${list.length} reported`} ${CATEGORY_WORD[category]} issue${list.length === 1 ? '' : 's'} here.`,
    });
  }
  if (input.room) {
    const crowd = crowdLevel(input.room);
    if (crowd && crowd.level !== 'CLEAR') {
      const pct = Math.round(crowd.ratio * 100);
      signals.push({
        kind: 'CROWD',
        level: crowd.level,
        ratio: crowd.ratio,
        source: input.room.occupancySource,
        text: `${crowd.level === 'AVOID' ? 'Full' : 'Busy'}: about ${pct}% of capacity${input.room.occupancySource ? ` (${SOURCE_WORD[input.room.occupancySource]})` : ''}.`,
      });
    }
  }
  const live = input.sessions.filter((s) => s.startsAt <= input.now && input.now < s.endsAt).sort((a, b) => a.endsAt - b.endsAt)[0];
  if (live) {
    signals.push({ kind: 'SESSION', level: 'BUSY', sessionId: live.id, endsAt: live.endsAt, text: `Session in progress: “${live.title}” until ${clock(live.endsAt)} UTC. Check in quietly.` });
  }
  return {
    spaceId,
    level: worstLevel(signals.map((s) => s.level)),
    accessIssue: input.incidents.some((i) => i.category === 'ACCESSIBILITY'),
    signals,
  };
}

/** Score change Quest Director applies for a place's condition. Avoid is strong; busy only nudges. */
export function conditionPenalty(condition: SpaceCondition | undefined, stepFree: boolean): number {
  if (!condition) return 0;
  const base = { CLEAR: 0, BUSY: -1, CAUTION: -2, AVOID: -5 }[condition.level];
  return base + (stepFree && condition.accessIssue ? -4 : 0);
}

// ---------- season pulse ----------

/** Counts below this are shown as "fewer than 3", so no count can identify one person. */
export const PULSE_MIN_COUNT = 3;
export const PULSE_WINDOW_MS = 60 * 60 * 1000;

/** A suppressed count: the number when it is at least PULSE_MIN_COUNT, otherwise null. */
export function suppress(count: number): number | null {
  return count >= PULSE_MIN_COUNT ? count : null;
}

export interface PulseAttempt {
  missionId: string;
  userId: string;
  status: 'STARTED' | 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED';
  startedAt: number;
  approvedAt: number | null;
}

export interface MissionPulse {
  missionId: string;
  /** People whose completion was verified in the last hour. Null when fewer than PULSE_MIN_COUNT. */
  verifiedLastHour: number | null;
  /** People who started in the last hour and have not finished. Null when fewer than PULSE_MIN_COUNT. */
  underwayNow: number | null;
  /** Everyone who completed it. Null when fewer than PULSE_MIN_COUNT. */
  completedTotal: number | null;
}

export interface SeasonPulse {
  seasonId: string | null;
  /** People who have started at least one of the season's missions. Suppressed below PULSE_MIN_COUNT. */
  participants: number | null;
  /** People who earned the season badge. Suppressed below PULSE_MIN_COUNT. */
  badgesEarned: number | null;
  missions: MissionPulse[];
  windowMinutes: number;
  minCount: number;
}

export function seasonPulse(input: {
  seasonId: string | null;
  seasonMissionIds: string[];
  missionIds: string[];
  attempts: PulseAttempt[];
  badgeHolders: number;
  now: number;
}): SeasonPulse {
  const since = input.now - PULSE_WINDOW_MS;
  const missions = input.missionIds.map((missionId): MissionPulse => {
    const mine = input.attempts.filter((a) => a.missionId === missionId);
    const verified = new Set(mine.filter((a) => a.status === 'APPROVED' && a.approvedAt !== null && a.approvedAt >= since && a.approvedAt <= input.now).map((a) => a.userId));
    const underway = new Set(mine.filter((a) => (a.status === 'STARTED' || a.status === 'PENDING_REVIEW') && a.startedAt >= since).map((a) => a.userId));
    const completed = new Set(mine.filter((a) => a.status === 'APPROVED').map((a) => a.userId));
    return { missionId, verifiedLastHour: suppress(verified.size), underwayNow: suppress(underway.size), completedTotal: suppress(completed.size) };
  });
  const seasonSet = new Set(input.seasonMissionIds);
  const participants = new Set(input.attempts.filter((a) => seasonSet.has(a.missionId)).map((a) => a.userId));
  return {
    seasonId: input.seasonId,
    participants: input.seasonId ? suppress(participants.size) : null,
    badgesEarned: input.seasonId ? suppress(input.badgeHolders) : null,
    missions,
    windowMinutes: PULSE_WINDOW_MS / 60_000,
    minCount: PULSE_MIN_COUNT,
  };
}

/**
 * Score change for momentum. Verified recently means the mission works right now (a small boost). Many people
 * underway in an already busy place spreads people out instead of sending everyone to the same room.
 */
export function pulsePenalty(pulse: MissionPulse | undefined, condition: SpaceCondition | undefined): number {
  if (!pulse) return 0;
  let score = 0;
  if (pulse.verifiedLastHour !== null) score += 0.5;
  if (pulse.underwayNow !== null && condition && condition.level !== 'CLEAR') score -= 1;
  return score;
}
