import { z } from 'zod';

/**
 * HELLO Field Atlas: pure rules. No storage, no clock. Every function takes the values it needs,
 * so the progression, season and verification decisions can be tested exactly.
 *
 * Invariants (see AGENTS.md):
 *  - XP is the sum of ledger entries. Nothing else stores XP.
 *  - A person completes a mission at most once. The attempt id is `${missionId}:${userId}`.
 *  - Seasons use UTC calendar months. Badges, once earned, are never revoked.
 */

export const MISSION_CATEGORIES = ['EXPLORATION', 'PARTICIPATION', 'CONTRIBUTION', 'CONNECTION', 'COORDINATION'] as const;
export type MissionCategory = (typeof MISSION_CATEGORIES)[number];

export const DIFFICULTIES = ['EASY', 'MEDIUM', 'HARD'] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

export const VERIFICATION_METHODS = ['WORKFLOW_RUN', 'CHECK_IN', 'MANUAL_REVIEW'] as const;
export type VerificationMethod = (typeof VERIFICATION_METHODS)[number];

export const MISSION_STATUSES = ['DRAFT', 'PUBLISHED', 'PAUSED'] as const;
export type MissionStatus = (typeof MISSION_STATUSES)[number];

export const ATTEMPT_STATUSES = ['STARTED', 'PENDING_REVIEW', 'APPROVED', 'REJECTED'] as const;
export type AttemptStatus = (typeof ATTEMPT_STATUSES)[number];

/** Resubmissions are allowed after a rejection, up to this many submissions in total. */
export const MAX_SUBMISSIONS = 3;
export const MAX_XP_PER_MISSION = 500;

export interface LevelDefinition {
  id: string;
  name: string;
  description: string;
  minXp: number;
  /** Achievement ids that must be held before the level is reached. Empty means XP alone. */
  requiredAchievements: string[];
  /** Visual identity key, used by the level marker in the UI. */
  identity: 'stone' | 'sage' | 'teal' | 'slate' | 'ochre' | 'clay' | 'plum' | 'ink' | 'gold';
  active: boolean;
  displayOrder: number;
}

/** Default progression for an event that has not configured its own. Editable by organisers. */
export const DEFAULT_LEVELS: LevelDefinition[] = [
  ['new-arrival', 'New Arrival', 'You have arrived. Start with one mission.', 0, 'stone'],
  ['explorer', 'Explorer', 'You have started to find your way around.', 100, 'sage'],
  ['wayfinder', 'Wayfinder', 'You move through the venue with purpose.', 250, 'teal'],
  ['connector', 'Connector', 'You help other people connect.', 450, 'slate'],
  ['contributor', 'Contributor', 'Your verified contributions help the event run.', 700, 'ochre'],
  ['field-specialist', 'Field Specialist', 'You complete harder missions reliably.', 1000, 'clay'],
  ['community-champion', 'Community Champion', 'You build community around the event.', 1400, 'plum'],
  ['event-architect', 'Event Architect', 'You shape how the event works for others.', 1900, 'ink'],
  ['master-coordinator', 'Master Coordinator', 'You coordinate the event at the highest level.', 2500, 'gold'],
].map(([id, name, description, minXp, identity], index) => ({
  id: String(id),
  name: String(name),
  description: String(description),
  minXp: Number(minXp),
  requiredAchievements: [],
  identity: identity as LevelDefinition['identity'],
  active: true,
  displayOrder: index,
}));

export const LevelSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]{2,40}$/),
  name: z.string().trim().min(2).max(60),
  description: z.string().trim().min(2).max(240),
  minXp: z.number().int().min(0).max(1_000_000),
  requiredAchievements: z.array(z.string().regex(/^[A-Z_0-9]{3,40}$/)).max(10),
  identity: z.enum(['stone', 'sage', 'teal', 'slate', 'ochre', 'clay', 'plum', 'ink', 'gold']),
  active: z.boolean(),
  displayOrder: z.number().int().min(0).max(100),
});

export const LevelsSchema = z
  .array(LevelSchema)
  .min(1)
  .max(20)
  .superRefine((levels, ctx) => {
    const ids = new Set(levels.map((l) => l.id));
    if (ids.size !== levels.length) ctx.addIssue({ code: 'custom', message: 'Level ids must be unique.' });
    const xps = new Set(levels.map((l) => l.minXp));
    if (xps.size !== levels.length) ctx.addIssue({ code: 'custom', message: 'Each level needs a different minimum XP.' });
    if (!levels.some((l) => l.active && l.minXp === 0)) ctx.addIssue({ code: 'custom', message: 'One active level must start at 0 XP.' });
  });

/**
 * The level a total XP amount reaches. Deterministic: the highest active level whose minimum is at or
 * below the XP and whose required achievements are all held. Levels are considered in minimum-XP order,
 * so a higher level that is blocked by an achievement does not stop a lower one from applying.
 */
export function levelFor(levels: LevelDefinition[], xp: number, achievements: ReadonlySet<string>): LevelDefinition {
  const ordered = levels.filter((l) => l.active).sort((a, b) => a.minXp - b.minXp || a.displayOrder - b.displayOrder);
  let reached: LevelDefinition | undefined;
  for (const level of ordered) {
    if (xp < level.minXp) break;
    if (level.requiredAchievements.every((a) => achievements.has(a))) reached = level;
  }
  const fallback = ordered[0];
  if (!reached && !fallback) throw new Error('No active level is defined.');
  return reached ?? (fallback as LevelDefinition);
}

/** The next level above the current one, with the XP still needed. Null at the top. */
export function nextLevel(levels: LevelDefinition[], current: LevelDefinition, xp: number): { level: LevelDefinition; xpNeeded: number } | null {
  const ordered = levels.filter((l) => l.active).sort((a, b) => a.minXp - b.minXp);
  const next = ordered.find((l) => l.minXp > current.minXp);
  if (!next) return null;
  return { level: next, xpNeeded: Math.max(0, next.minXp - xp) };
}

export interface AchievementDefinition {
  id: string;
  name: string;
  description: string;
  kind: 'PERMANENT';
}

export const ACHIEVEMENTS: AchievementDefinition[] = [
  { id: 'FIRST_MISSION', name: 'First step', description: 'Complete your first verified mission.', kind: 'PERMANENT' },
  { id: 'FIVE_MISSIONS', name: 'Collector', description: 'Complete five verified missions.', kind: 'PERMANENT' },
  { id: 'WAYFINDER', name: 'Wayfinder', description: 'Reach the Wayfinder level.', kind: 'PERMANENT' },
];

/** Achievements earned from the approved-mission count and the XP-derived level. Pure. */
export function achievementsEarned(approvedCount: number, levelIndex: number): string[] {
  const out: string[] = [];
  if (approvedCount >= 1) out.push('FIRST_MISSION');
  if (approvedCount >= 5) out.push('FIVE_MISSIONS');
  if (levelIndex >= 2) out.push('WAYFINDER');
  return out;
}

// ---------- monthly seasons (UTC calendar months) ----------

export interface SeasonWindow {
  startsAt: number;
  endsAt: number;
}

/** How far `timeZone` is ahead of UTC at the instant `utcMs`, in milliseconds (daylight saving included). */
export function zoneOffsetMs(timeZone: string, utcMs: number): number {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(utcMs));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}

/** The UTC instant of local midnight at the start of `year`-`month`-`day` in `timeZone`. */
function localMidnight(timeZone: string, year: number, month: number, day: number): number {
  const wall = Date.UTC(year, month - 1, day);
  // Two passes: the offset at the guessed instant can differ from the one at the true instant near a DST change.
  const first = wall - zoneOffsetMs(timeZone, wall);
  return wall - zoneOffsetMs(timeZone, first);
}

export function isTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(0);
    return true;
  } catch {
    return false;
  }
}

/**
 * The calendar month `year`/`month` (1-12) in the event's time zone, as UTC instants. The end is the last
 * millisecond of the month. A season in an event in Tokyo starts at midnight in Tokyo, not at midnight UTC
 * (which used to be the rule for every event, so a non-UTC event's season opened and closed hours off).
 */
export function monthWindow(year: number, month: number, timeZone = 'UTC'): SeasonWindow {
  if (!Number.isInteger(year) || year < 2000 || year > 2200) throw new RangeError('Season year is out of range.');
  if (!Number.isInteger(month) || month < 1 || month > 12) throw new RangeError('Season month must be 1 to 12.');
  if (!isTimeZone(timeZone)) throw new RangeError(`Unknown time zone: ${timeZone}.`);
  const startsAt = localMidnight(timeZone, year, month, 1);
  const endsAt = localMidnight(timeZone, month === 12 ? year + 1 : year, month === 12 ? 1 : month + 1, 1) - 1;
  return { startsAt, endsAt };
}

export type SeasonPhase = 'UPCOMING' | 'ACTIVE' | 'ENDED';

export function seasonPhase(season: SeasonWindow, now: number): SeasonPhase {
  if (now < season.startsAt) return 'UPCOMING';
  if (now > season.endsAt) return 'ENDED';
  return 'ACTIVE';
}

/** True when an instant falls inside a window, inclusive at both ends. */
export function inWindow(at: number, window: { startsAt: number | null; endsAt: number | null }): boolean {
  if (window.startsAt !== null && at < window.startsAt) return false;
  if (window.endsAt !== null && at > window.endsAt) return false;
  return true;
}

// ---------- missions ----------

export const MissionSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9-]{3,60}$/),
    title: z.string().trim().min(3).max(120),
    description: z.string().trim().min(10).max(800),
    whyItMatters: z.string().trim().min(10).max(400),
    category: z.enum(MISSION_CATEGORIES),
    difficulty: z.enum(DIFFICULTIES),
    requiredLevel: z.number().int().min(0).max(20),
    xp: z.number().int().min(1).max(MAX_XP_PER_MISSION),
    seasonId: z.string().nullable(),
    spaceId: z.string().nullable(),
    /** Set explicitly when a mission has no place in the venue. Required when spaceId is null. */
    nonLocation: z.boolean(),
    prerequisiteIds: z.array(z.string()).max(5),
    verification: z.discriminatedUnion('method', [
      z.object({ method: z.literal('WORKFLOW_RUN'), workflowId: z.string().regex(/^[a-z-]{3,30}$/) }),
      z.object({ method: z.literal('CHECK_IN'), stationId: z.string().min(3).max(60) }),
      z.object({ method: z.literal('MANUAL_REVIEW'), evidencePrompt: z.string().trim().min(5).max(240) }),
    ]),
    estimateMinutes: z.number().int().min(1).max(480).nullable(),
    accessibilityNote: z.string().trim().max(400),
    startsAt: z.number().nullable(),
    endsAt: z.number().nullable(),
    status: z.enum(MISSION_STATUSES),
    /** Always 1. Stored so the rule is visible in the record. Repeat completions are not awarded. */
    maxCompletionsPerPerson: z.literal(1),
    source: z.enum(['ORGANISER', 'QUEST_DIRECTOR', 'DEMO_SEED']),
  })
  .superRefine((m, ctx) => {
    if (m.spaceId === null && !m.nonLocation) ctx.addIssue({ code: 'custom', path: ['nonLocation'], message: 'A mission with no location must say so explicitly.' });
    if (m.spaceId !== null && m.nonLocation) ctx.addIssue({ code: 'custom', path: ['nonLocation'], message: 'A mission with a location cannot also be non-location.' });
    if (m.startsAt !== null && m.endsAt !== null && m.endsAt <= m.startsAt) ctx.addIssue({ code: 'custom', path: ['endsAt'], message: 'The end must be after the start.' });
    if (m.prerequisiteIds.includes(m.id)) ctx.addIssue({ code: 'custom', path: ['prerequisiteIds'], message: 'A mission cannot require itself.' });
  });

export interface MissionLike {
  id: string;
  requiredLevel: number;
  prerequisiteIds: string[];
  startsAt: number | null;
  endsAt: number | null;
  status: MissionStatus;
}

export type Availability =
  | { state: 'AVAILABLE' }
  | { state: 'LOCKED_LEVEL'; requiredLevel: number }
  | { state: 'LOCKED_PREREQUISITE'; missing: string[] }
  | { state: 'NOT_YET' }
  | { state: 'ENDED' }
  | { state: 'PAUSED' }
  | { state: 'DRAFT' };

/** Whether a person may start a mission now. Pure: the caller supplies progress and level. */
export function availability(mission: MissionLike, now: number, levelIndex: number, completedMissionIds: ReadonlySet<string>): Availability {
  if (mission.status === 'DRAFT') return { state: 'DRAFT' };
  if (mission.status === 'PAUSED') return { state: 'PAUSED' };
  if (mission.startsAt !== null && now < mission.startsAt) return { state: 'NOT_YET' };
  if (mission.endsAt !== null && now > mission.endsAt) return { state: 'ENDED' };
  if (levelIndex < mission.requiredLevel) return { state: 'LOCKED_LEVEL', requiredLevel: mission.requiredLevel };
  const missing = mission.prerequisiteIds.filter((p) => !completedMissionIds.has(p));
  if (missing.length > 0) return { state: 'LOCKED_PREREQUISITE', missing };
  return { state: 'AVAILABLE' };
}

// ---------- XP and the verification policy ----------

/** The XP a verified mission awards. Only the server computes it, from the stored definition. */
export function missionXp(mission: { xp: number }): number {
  return mission.xp;
}

export interface VerificationInput {
  method: VerificationMethod;
  /** WORKFLOW_RUN: a succeeded run of the required workflow by this person, started after the attempt. */
  matchingWorkflowRun: boolean;
  /** CHECK_IN: the submitted code matches the station's current, unexpired code. */
  checkInValid: boolean;
  /** CHECK_IN: the code was present but expired. Reported separately so the reason is clear. */
  checkInExpired: boolean;
  /** MANUAL_REVIEW: the evidence text, already trimmed. */
  evidenceText: string;
}

export type VerificationDecision =
  | { outcome: 'APPROVE' }
  | { outcome: 'PENDING_REVIEW' }
  | { outcome: 'NOT_VERIFIED'; reason: string };

/**
 * The deterministic verification policy. AI never reaches this function. Automatic methods approve only
 * on server-checked facts. Manual review queues the evidence and never approves it.
 */
export function decideVerification(input: VerificationInput): VerificationDecision {
  switch (input.method) {
    case 'WORKFLOW_RUN':
      return input.matchingWorkflowRun
        ? { outcome: 'APPROVE' }
        : { outcome: 'NOT_VERIFIED', reason: 'Run the required workflow from the workflow canvas, then submit again.' };
    case 'CHECK_IN':
      if (input.checkInValid) return { outcome: 'APPROVE' };
      if (input.checkInExpired) return { outcome: 'NOT_VERIFIED', reason: 'That check-in code has expired. Ask staff at the station for the current code.' };
      return { outcome: 'NOT_VERIFIED', reason: 'That check-in code does not match this station. Check it and try again.' };
    case 'MANUAL_REVIEW':
      if (input.evidenceText.length < 10) return { outcome: 'NOT_VERIFIED', reason: 'Describe what you did in at least 10 characters.' };
      return { outcome: 'PENDING_REVIEW' };
  }
}

export const EvidenceSchema = z.object({
  text: z.string().trim().max(500).optional().default(''),
  checkInCode: z.string().trim().max(32).optional().default(''),
});

/** Normalises evidence for duplicate detection: lower case, collapsed spaces, no punctuation. */
export function normaliseEvidence(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

export const CHECK_IN_CODE_TTL_MS = 4 * 60 * 60 * 1000;
