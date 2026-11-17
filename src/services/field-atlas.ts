import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { DomainError } from '../domain/errors';
import { requireCapability, audit, notify, type ServiceContext } from './context';
import type { FieldAttempt, FieldBadge, FieldFlag, FieldLedgerEntry, FieldMission, FieldSeason, FieldStation, FieldLevelConfig } from '../domain/product';
import {
  ACHIEVEMENTS,
  CHECK_IN_CODE_TTL_MS,
  DEFAULT_LEVELS,
  LevelsSchema,
  MAX_SUBMISSIONS,
  MissionSchema,
  achievementsEarned,
  availability,
  decideVerification,
  inWindow,
  levelFor,
  monthWindow,
  nextLevel,
  normaliseEvidence,
  seasonPhase,
  type Availability,
  type LevelDefinition,
  type VerificationMethod,
} from '../domain/field/rules';
import { WORKFLOWS } from './workflows';

/**
 * HELLO Field Atlas: missions, XP, levels, monthly seasons and badges.
 *
 * Server rules that the UI cannot change:
 *  - XP is only written by `awardMission`, `adjustXp` (audited, append-only) and season bonuses.
 *  - Each award writes a ledger entry whose id is derived from its source, so a retry or a concurrent
 *    second approval inserts nothing new.
 *  - An attempt moves to APPROVED exactly once (a conditional write). Only that winner awards.
 *  - Manual evidence is never approved automatically. AI never calls these functions.
 */

const SALT_BYTES = 9;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

// ---------- helpers ----------

function sha(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function sameDigest(a: string, b: string): boolean {
  const x = Buffer.from(a, 'hex');
  const y = Buffer.from(b, 'hex');
  return x.length === y.length && timingSafeEqual(x, y);
}

/** A check-in code a person can read off a sign: 8 characters, no ambiguous letters. */
export function newCheckInCode(): string {
  const bytes = randomBytes(SALT_BYTES);
  let out = '';
  for (let i = 0; i < 8; i += 1) out += CODE_ALPHABET.charAt((bytes[i] ?? 0) % CODE_ALPHABET.length);
  return out;
}

const codeHash = (stationId: string, code: string) => sha(`${stationId}:${code.toUpperCase().replace(/[^A-Z0-9]/g, '')}`);

const attemptId = (missionId: string, userId: string) => `${missionId}:${userId}`;

async function eventMission(ctx: ServiceContext, eventId: string, missionId: string): Promise<FieldMission> {
  const mission = /^[a-z0-9-]{3,60}$/.test(missionId) ? await ctx.store.docGet('fieldMissions', missionId) : null;
  if (!mission || mission.eventId !== eventId) throw new DomainError('NOT_FOUND', 'That mission does not exist.');
  return mission;
}

async function eventSeason(ctx: ServiceContext, eventId: string, seasonId: string): Promise<FieldSeason> {
  const season = await ctx.store.docGet('fieldSeasons', seasonId);
  if (!season || season.eventId !== eventId) throw new DomainError('NOT_FOUND', 'That season does not exist.');
  return season;
}

// ---------- progression ----------

export async function loadLevels(ctx: ServiceContext, eventId: string): Promise<LevelDefinition[]> {
  const config = await ctx.store.docGet('fieldLevels', eventId);
  return config ? config.levels : DEFAULT_LEVELS;
}

async function ledgerOf(ctx: ServiceContext, eventId: string, userId: string): Promise<FieldLedgerEntry[]> {
  return ctx.store.docList('fieldLedger', { eventId, userId });
}

async function badgesOf(ctx: ServiceContext, eventId: string, userId: string): Promise<FieldBadge[]> {
  return ctx.store.docList('fieldBadges', { eventId, userId });
}

async function approvedAttemptsOf(ctx: ServiceContext, eventId: string, userId: string): Promise<FieldAttempt[]> {
  return (await ctx.store.docList('fieldAttempts', { eventId, userId })).filter((a) => a.status === 'APPROVED');
}

export interface PlayerState {
  xp: number;
  /** One-based position of the current level in the event's ordered level table. */
  levelNumber: number;
  level: { id: string; name: string; description: string; identity: LevelDefinition['identity']; minXp: number };
  next: { id: string; name: string; xpNeeded: number } | null;
  /** Progress through the current level band, 0 to 1. Clamped; 1 at the top level. */
  progress: number;
  achievements: string[];
  approvedMissionIds: string[];
}

export async function playerState(ctx: ServiceContext, eventId: string, userId: string): Promise<PlayerState> {
  const levels = await loadLevels(ctx, eventId);
  const [ledger, badges, approved] = await Promise.all([ledgerOf(ctx, eventId, userId), badgesOf(ctx, eventId, userId), approvedAttemptsOf(ctx, eventId, userId)]);
  const xp = ledger.reduce((sum, e) => sum + e.amount, 0);
  const held = new Set(badges.map((b) => b.badgeId));
  const level = levelFor(levels, xp, held);
  const next = nextLevel(levels, level, xp);
  const ordered = levels.filter((l) => l.active).sort((a, b) => a.minXp - b.minXp || a.displayOrder - b.displayOrder);
  const levelNumber = ordered.findIndex((l) => l.id === level.id) + 1;
  const span = next ? next.level.minXp - level.minXp : 1;
  const progress = next ? Math.min(1, Math.max(0, (xp - level.minXp) / span)) : 1;
  return {
    xp,
    levelNumber,
    level: { id: level.id, name: level.name, description: level.description, identity: level.identity, minXp: level.minXp },
    next: next ? { id: next.level.id, name: next.level.name, xpNeeded: next.xpNeeded } : null,
    progress,
    achievements: badges.filter((b) => b.kind === 'PERMANENT').map((b) => b.badgeId),
    approvedMissionIds: approved.map((a) => a.missionId),
  };
}

// ---------- awards (idempotent) ----------

interface AwardOutcome {
  xpAwarded: number;
  levelBefore: string;
  levelAfter: string;
  badges: Array<{ id: string; name: string; kind: 'PERMANENT' | 'MONTHLY' }>;
  seasonBonus: number;
}

/**
 * Writes everything an approved mission is worth. Each write is keyed by its source, so calling this
 * twice for one approval cannot award twice. The caller must already have won the APPROVED transition.
 */
async function awardMission(ctx: ServiceContext, mission: FieldMission, userId: string): Promise<AwardOutcome> {
  const eventId = mission.eventId;
  const levels = await loadLevels(ctx, eventId);
  const beforeXp = (await ledgerOf(ctx, eventId, userId)).reduce((s, e) => s + e.amount, 0);
  const beforeBadges = new Set((await badgesOf(ctx, eventId, userId)).map((b) => b.badgeId));
  const now = ctx.now();
  let xpAwarded = 0;
  let seasonBonus = 0;
  const earned: AwardOutcome['badges'] = [];
  const earnedIds = new Set<string>();

  const ledger = async (entry: Omit<FieldLedgerEntry, 'eventId' | 'userId' | 'createdAt'>): Promise<number> => {
    const written = await ctx.store.docPutIfAbsent('fieldLedger', { ...entry, eventId, userId, createdAt: now });
    return written ? entry.amount : 0;
  };
  xpAwarded += await ledger({ id: `${userId}:mission:${mission.id}`, amount: mission.xp, kind: 'MISSION', sourceId: mission.id, reason: `Verified: ${mission.title}`, actorId: null });

  if (mission.seasonId) {
    const season = await ctx.store.docGet('fieldSeasons', mission.seasonId);
    if (season && season.eventId === eventId && season.requiredMissionIds.length > 0) {
      const approved = new Set((await approvedAttemptsOf(ctx, eventId, userId)).filter((a) => a.approvedAt !== null && inWindow(a.approvedAt, { startsAt: season.startsAt, endsAt: season.endsAt })).map((a) => a.missionId));
      if (season.requiredMissionIds.every((m) => approved.has(m))) {
        seasonBonus = await ledger({ id: `${userId}:season:${season.id}`, amount: season.bonusXp, kind: 'SEASON_BONUS', sourceId: season.id, reason: `Season complete: ${season.title}`, actorId: null });
        xpAwarded += seasonBonus;
        const badgeId = `season-${season.id}`;
        const badge: FieldBadge = { id: `${userId}:${badgeId}`, eventId, userId, badgeId, kind: 'MONTHLY', seasonId: season.id, name: season.title, artwork: season.artwork, earnedAt: now };
        if (await ctx.store.docPutIfAbsent('fieldBadges', badge)) {
          earned.push({ id: badge.id, name: badge.name, kind: 'MONTHLY' });
          earnedIds.add(badgeId);
        }
      }
    }
  }

  const approvedCount = (await approvedAttemptsOf(ctx, eventId, userId)).length;
  const afterXp = beforeXp + xpAwarded;
  const ordered = levels.filter((l) => l.active).sort((a, b) => a.minXp - b.minXp);
  const levelIndexAfter = ordered.findIndex((l) => l.id === levelFor(levels, afterXp, beforeBadges).id);
  for (const id of achievementsEarned(approvedCount, levelIndexAfter)) {
    const def = ACHIEVEMENTS.find((a) => a.id === id);
    if (!def) continue;
    const badge: FieldBadge = { id: `${userId}:${id}`, eventId, userId, badgeId: id, kind: 'PERMANENT', seasonId: null, name: def.name, artwork: 'achievement', earnedAt: now };
    if (await ctx.store.docPutIfAbsent('fieldBadges', badge)) {
      earned.push({ id: badge.id, name: def.name, kind: 'PERMANENT' });
      earnedIds.add(id);
    }
  }

  const levelBefore = levelFor(levels, beforeXp, beforeBadges);
  const levelAfter = levelFor(levels, afterXp, new Set([...beforeBadges, ...earnedIds]));
  return { xpAwarded, levelBefore: levelBefore.id, levelAfter: levelAfter.id, badges: earned, seasonBonus };
}

/** Conditional transition to APPROVED. Returns true only for the single caller that performed it. */
async function approveAttempt(ctx: ServiceContext, id: string, reviewer: string | null): Promise<FieldAttempt | null> {
  const claim = { won: false };
  const updated = await ctx.store.docMutate('fieldAttempts', id, (doc) => {
    if (doc.status === 'APPROVED' || doc.status === 'REJECTED') return null;
    claim.won = true;
    return { ...doc, status: 'APPROVED', approvedAt: ctx.now(), reviewedBy: reviewer, lastOutcome: 'Verified.', version: doc.version + 1 };
  });
  return claim.won ? updated : null;
}

// ---------- the learner's view ----------

export interface MissionView {
  id: string;
  title: string;
  description: string;
  whyItMatters: string;
  category: FieldMission['category'];
  difficulty: FieldMission['difficulty'];
  requiredLevel: number;
  xp: number;
  seasonId: string | null;
  spaceId: string | null;
  nonLocation: boolean;
  prerequisiteIds: string[];
  verification: { method: VerificationMethod; detail: string };
  estimateMinutes: number | null;
  accessibilityNote: string;
  endsAt: number | null;
  availability: Availability;
  attempt: { status: FieldAttempt['status'] | 'NONE'; submissions: number; lastOutcome: string };
}

function verificationDetail(m: FieldMission): string {
  const v = m.verification;
  switch (v.method) {
    case 'WORKFLOW_RUN': {
      const workflow = WORKFLOWS.find((x) => x.id === v.workflowId);
      return `Run the “${workflow?.name ?? 'required'}” workflow from the workflow canvas.`;
    }
    case 'CHECK_IN':
      return 'Get the check-in code from staff at the station and enter it here.';
    case 'MANUAL_REVIEW':
      return `Submit evidence for organiser review. ${v.evidencePrompt}`;
  }
}

export async function listMissionsForViewer(ctx: ServiceContext, eventId: string, userId: string): Promise<MissionView[]> {
  const now = ctx.now();
  const [missions, state, attempts] = await Promise.all([
    ctx.store.docList('fieldMissions', { eventId }),
    playerState(ctx, eventId, userId),
    ctx.store.docList('fieldAttempts', { eventId, userId }),
  ]);
  const levels = await loadLevels(ctx, eventId);
  const levelIndex = levels.filter((l) => l.active).sort((a, b) => a.minXp - b.minXp).findIndex((l) => l.id === state.level.id);
  const completed = new Set(state.approvedMissionIds);
  const byMission = new Map(attempts.map((a) => [a.missionId, a]));
  return missions
    .filter((m) => m.status !== 'DRAFT')
    .sort((a, b) => a.requiredLevel - b.requiredLevel || a.xp - b.xp || a.id.localeCompare(b.id))
    .map((m) => {
      const a = byMission.get(m.id);
      return {
        id: m.id,
        title: m.title,
        description: m.description,
        whyItMatters: m.whyItMatters,
        category: m.category,
        difficulty: m.difficulty,
        requiredLevel: m.requiredLevel,
        xp: m.xp,
        seasonId: m.seasonId,
        spaceId: m.spaceId,
        nonLocation: m.nonLocation,
        prerequisiteIds: m.prerequisiteIds,
        verification: { method: m.verification.method, detail: verificationDetail(m) },
        estimateMinutes: m.estimateMinutes,
        accessibilityNote: m.accessibilityNote,
        endsAt: m.endsAt,
        availability: completed.has(m.id) ? { state: 'AVAILABLE' } : availability(m, now, levelIndex, completed),
        attempt: { status: a?.status ?? 'NONE', submissions: a?.submissions ?? 0, lastOutcome: a?.lastOutcome ?? '' },
      };
    });
}

export interface SeasonView {
  id: string;
  title: string;
  theme: string;
  description: string;
  year: number;
  month: number;
  startsAt: number;
  endsAt: number;
  phase: ReturnType<typeof seasonPhase>;
  artwork: FieldSeason['artwork'];
  bonusXp: number;
  missions: Array<{ id: string; title: string; required: boolean; status: FieldAttempt['status'] | 'NONE' }>;
  earned: boolean;
  requiredRemaining: number;
}

/** The current season (or the nearest upcoming one), plus every past season for the cabinet. */
export async function seasonsForViewer(ctx: ServiceContext, eventId: string, userId: string): Promise<{ current: SeasonView | null; history: SeasonView[] }> {
  const now = ctx.now();
  const [seasons, attempts, badges, missions] = await Promise.all([
    ctx.store.docList('fieldSeasons', { eventId }),
    ctx.store.docList('fieldAttempts', { eventId, userId }),
    badgesOf(ctx, eventId, userId),
    ctx.store.docList('fieldMissions', { eventId }),
  ]);
  const byMission = new Map(attempts.map((a) => [a.missionId, a]));
  const titles = new Map(missions.map((m) => [m.id, m.title]));
  const earnedSeasons = new Set(badges.map((b) => b.seasonId).filter((x): x is string => x !== null));
  const views = seasons
    .filter((s) => s.status !== 'DRAFT')
    .sort((a, b) => a.startsAt - b.startsAt)
    .map((s): SeasonView => {
      const required = new Set(s.requiredMissionIds);
      const remaining = s.requiredMissionIds.filter((m) => byMission.get(m)?.status !== 'APPROVED').length;
      return {
        id: s.id,
        title: s.title,
        theme: s.theme,
        description: s.description,
        year: s.year,
        month: s.month,
        startsAt: s.startsAt,
        endsAt: s.endsAt,
        phase: seasonPhase(s, now),
        artwork: s.artwork,
        bonusXp: s.bonusXp,
        missions: s.missionIds.map((m) => ({ id: m, title: titles.get(m) ?? 'Mission', required: required.has(m), status: byMission.get(m)?.status ?? 'NONE' })),
        earned: earnedSeasons.has(s.id),
        requiredRemaining: remaining,
      };
    });
  const current = views.find((v) => v.phase === 'ACTIVE') ?? views.find((v) => v.phase === 'UPCOMING') ?? null;
  const history = views.filter((v) => v !== current).reverse();
  return { current, history };
}

// ---------- check-in stations and evidence ----------

export const SubmitSchema = z.object({
  text: z.string().trim().max(500).optional().default(''),
  checkInCode: z.string().trim().max(32).optional().default(''),
});

export async function startMission(ctx: ServiceContext, eventId: string, userId: string, missionId: string): Promise<{ status: string; created: boolean }> {
  await requireCapability(ctx, eventId, userId, 'event.read');
  const mission = await eventMission(ctx, eventId, missionId);
  const views = await listMissionsForViewer(ctx, eventId, userId);
  const view = views.find((v) => v.id === mission.id);
  if (!view) throw new DomainError('NOT_FOUND', 'That mission is not published.');
  if (view.attempt.status === 'APPROVED') return { status: 'APPROVED', created: false };
  if (view.availability.state !== 'AVAILABLE') throw new DomainError('FORBIDDEN', availabilityMessage(view.availability));
  const now = ctx.now();
  const id = attemptId(mission.id, userId);
  const created = await ctx.store.docPutIfAbsent('fieldAttempts', {
    id,
    eventId,
    missionId: mission.id,
    userId,
    status: 'STARTED',
    submissions: 0,
    evidenceText: '',
    normalisedEvidence: '',
    lastOutcome: 'Started. Complete the step, then submit.',
    startedAt: now,
    submittedAt: null,
    approvedAt: null,
    reviewedBy: null,
    version: 1,
  });
  if (!created) {
    const existing = await ctx.store.docGet('fieldAttempts', id);
    return { status: existing?.status ?? 'STARTED', created: false };
  }
  return { status: 'STARTED', created: true };
}

function availabilityMessage(a: Availability): string {
  switch (a.state) {
    case 'LOCKED_LEVEL':
      return `This mission unlocks at level ${a.requiredLevel}.`;
    case 'LOCKED_PREREQUISITE':
      return 'Complete the mission this one builds on first.';
    case 'NOT_YET':
      return 'This mission has not opened yet.';
    case 'ENDED':
      return 'This mission has ended.';
    case 'PAUSED':
      return 'This mission is paused.';
    case 'DRAFT':
      return 'This mission is not published.';
    case 'AVAILABLE':
      return 'This mission is available.';
  }
}

export interface SubmitResult {
  outcome: 'APPROVED' | 'PENDING_REVIEW' | 'NOT_VERIFIED' | 'ALREADY_COMPLETE';
  message: string;
  xpAwarded: number;
  levelUp: { from: string; to: string } | null;
  badges: Array<{ id: string; name: string; kind: 'PERMANENT' | 'MONTHLY' }>;
  playerXp: number;
}

/** Runs the verification pipeline for one submission. The only path to an award. */
export async function submitMission(ctx: ServiceContext, eventId: string, userId: string, missionId: string, input: z.infer<typeof SubmitSchema>): Promise<SubmitResult> {
  await requireCapability(ctx, eventId, userId, 'event.read');
  const parsed = SubmitSchema.safeParse(input);
  if (!parsed.success) throw new DomainError('VALIDATION_FAILED', 'Check the evidence you entered.');
  const mission = await eventMission(ctx, eventId, missionId);
  const id = attemptId(mission.id, userId);
  const attempt = await ctx.store.docGet('fieldAttempts', id);
  if (!attempt) throw new DomainError('FORBIDDEN', 'Start the mission before you submit evidence.');
  if (attempt.status === 'APPROVED') {
    return { outcome: 'ALREADY_COMPLETE', message: 'You have already completed this mission. It counts once.', xpAwarded: 0, levelUp: null, badges: [], playerXp: (await playerState(ctx, eventId, userId)).xp };
  }
  if (attempt.status === 'PENDING_REVIEW') {
    return { outcome: 'PENDING_REVIEW', message: 'Your evidence is waiting for an organiser to review it.', xpAwarded: 0, levelUp: null, badges: [], playerXp: (await playerState(ctx, eventId, userId)).xp };
  }
  if (attempt.submissions >= MAX_SUBMISSIONS) {
    await flag(ctx, eventId, userId, mission.id, 'REPEATED_SUBMISSIONS', `Submitted ${attempt.submissions} times without completing.`);
    throw new DomainError('RATE_LIMITED', 'You have used all submissions for this mission. Ask staff for help.');
  }
  const views = await listMissionsForViewer(ctx, eventId, userId);
  const view = views.find((v) => v.id === mission.id);
  if (!view || view.availability.state !== 'AVAILABLE') throw new DomainError('FORBIDDEN', view ? availabilityMessage(view.availability) : 'That mission is not available.');

  const v = mission.verification;
  let matchingWorkflowRun = false;
  let checkInValid = false;
  let checkInExpired = false;
  if (v.method === 'WORKFLOW_RUN') {
    const runs = await ctx.store.docList('workflowRuns', { eventId, actorId: userId, workflowId: v.workflowId });
    matchingWorkflowRun = runs.some((r) => r.status === 'SUCCEEDED' && r.startedAt >= attempt.startedAt);
  }
  if (v.method === 'CHECK_IN') {
    const station = await ctx.store.docGet('fieldStations', v.stationId);
    if (!station || station.eventId !== eventId) throw new DomainError('NOT_FOUND', 'The check-in station for this mission is not set up yet.');
    const code = parsed.data.checkInCode;
    const matches = code.length > 0 && sameDigest(codeHash(station.id, code), station.codeHash);
    if (matches) {
      checkInExpired = ctx.now() > station.codeExpiresAt;
      checkInValid = !checkInExpired;
    }
  }
  const evidenceText = parsed.data.text;
  const decision = decideVerification({ method: v.method, matchingWorkflowRun, checkInValid, checkInExpired, evidenceText });

  const normalised = normaliseEvidence(evidenceText);
  if (v.method === 'MANUAL_REVIEW' && normalised.length > 0) {
    const same = (await ctx.store.docList('fieldAttempts', { eventId, missionId: mission.id })).filter((a) => a.userId !== userId && a.normalisedEvidence === normalised);
    if (same.length > 0) await flag(ctx, eventId, userId, mission.id, 'DUPLICATE_EVIDENCE', `Evidence matches ${same.length} other submission(s) for this mission.`);
  }
  if (v.method === 'CHECK_IN' && !checkInValid && parsed.data.checkInCode.length > 0) {
    if (checkInExpired) await flag(ctx, eventId, userId, mission.id, 'EXPIRED_CHECK_IN', 'Submitted a check-in code after it expired.');
    else if (attempt.submissions + 1 >= MAX_SUBMISSIONS) await flag(ctx, eventId, userId, mission.id, 'REPEATED_BAD_CODE', 'Repeated check-in attempts with a code that does not match.');
  }

  const now = ctx.now();
  const bump = (status: FieldAttempt['status'], lastOutcome: string) =>
    ctx.store.docMutate('fieldAttempts', id, (doc) => {
      if (doc.status === 'APPROVED') return null;
      if (doc.submissions >= MAX_SUBMISSIONS) return null;
      return { ...doc, status, lastOutcome, submissions: doc.submissions + 1, evidenceText, normalisedEvidence: normalised, submittedAt: now, version: doc.version + 1 };
    });

  if (decision.outcome === 'PENDING_REVIEW') {
    await bump('PENDING_REVIEW', 'Waiting for an organiser to review your evidence.');
    await audit(ctx, eventId, userId, 'field.evidence.submitted', 'mission', mission.id, `Evidence submitted for review (${normalised.length} characters).`);
    return { outcome: 'PENDING_REVIEW', message: 'Submitted. An organiser will review your evidence.', xpAwarded: 0, levelUp: null, badges: [], playerXp: (await playerState(ctx, eventId, userId)).xp };
  }
  if (decision.outcome === 'NOT_VERIFIED') {
    await bump('STARTED', decision.reason);
    return { outcome: 'NOT_VERIFIED', message: decision.reason, xpAwarded: 0, levelUp: null, badges: [], playerXp: (await playerState(ctx, eventId, userId)).xp };
  }

  // APPROVE: only the caller that wins the transition awards anything.
  const won = await approveAttempt(ctx, id, null);
  if (!won) {
    return { outcome: 'ALREADY_COMPLETE', message: 'You have already completed this mission. It counts once.', xpAwarded: 0, levelUp: null, badges: [], playerXp: (await playerState(ctx, eventId, userId)).xp };
  }
  const award = await awardMission(ctx, mission, userId);
  await audit(ctx, eventId, userId, 'field.mission.verified', 'mission', mission.id, `Verified by ${v.method}. +${award.xpAwarded} XP.`);
  const after = await playerState(ctx, eventId, userId);
  await notifyAward(ctx, eventId, userId, mission, award);
  return {
    outcome: 'APPROVED',
    message: `Verified. +${award.xpAwarded} XP.`,
    xpAwarded: award.xpAwarded,
    levelUp: award.levelBefore !== award.levelAfter ? { from: award.levelBefore, to: award.levelAfter } : null,
    badges: award.badges,
    playerXp: after.xp,
  };
}

async function notifyAward(ctx: ServiceContext, eventId: string, userId: string, mission: FieldMission, award: AwardOutcome): Promise<void> {
  const href = `/events/${eventId}/atlas`;
  await notify(ctx, { eventId, recipientUserId: userId, kind: 'FIELD_MISSION', body: `Mission verified: ${mission.title}. +${award.xpAwarded} XP.`, href, dedupeParts: ['mission', mission.id] });
  if (award.levelBefore !== award.levelAfter) {
    await notify(ctx, { eventId, recipientUserId: userId, kind: 'FIELD_LEVEL', body: `You reached a new level: ${award.levelAfter}.`, href, dedupeParts: ['level', award.levelAfter] });
  }
  for (const badge of award.badges) {
    await notify(ctx, { eventId, recipientUserId: userId, kind: 'FIELD_BADGE', body: `Badge earned: ${badge.name}.`, href, dedupeParts: ['badge', badge.id] });
  }
}

async function flag(ctx: ServiceContext, eventId: string, userId: string | null, missionId: string | null, kind: FieldFlag['kind'], detail: string): Promise<void> {
  await ctx.store.docPut('fieldFlags', { id: ctx.newId('flg'), eventId, userId, missionId, kind, detail, status: 'OPEN', createdAt: ctx.now() });
}

// ---------- organiser: review queue ----------

export async function reviewAttempt(ctx: ServiceContext, eventId: string, reviewerId: string, attempt: string, decision: 'APPROVE' | 'REJECT', note: string): Promise<{ status: string }> {
  await requireCapability(ctx, eventId, reviewerId, 'field.review');
  const doc = await ctx.store.docGet('fieldAttempts', attempt);
  if (!doc || doc.eventId !== eventId) throw new DomainError('NOT_FOUND', 'That submission does not exist.');
  if (doc.status !== 'PENDING_REVIEW') throw new DomainError('VERSION_CONFLICT', 'This submission is no longer waiting for review.');
  if (decision === 'REJECT') {
    const updated = await ctx.store.docMutate('fieldAttempts', attempt, (d) =>
      d.status !== 'PENDING_REVIEW' ? null : { ...d, status: 'REJECTED', reviewedBy: reviewerId, lastOutcome: note || 'Not accepted. You can submit again.', version: d.version + 1 },
    );
    if (!updated) throw new DomainError('VERSION_CONFLICT', 'This submission was reviewed by someone else.');
    await audit(ctx, eventId, reviewerId, 'field.evidence.rejected', 'attempt', attempt, note || 'Rejected.');
    return { status: 'REJECTED' };
  }
  const mission = await eventMission(ctx, eventId, doc.missionId);
  const won = await approveAttempt(ctx, attempt, reviewerId);
  if (!won) throw new DomainError('VERSION_CONFLICT', 'This submission was reviewed by someone else.');
  const award = await awardMission(ctx, mission, doc.userId);
  await audit(ctx, eventId, reviewerId, 'field.evidence.approved', 'attempt', attempt, `Approved by organiser. +${award.xpAwarded} XP to the attendee.`);
  await notifyAward(ctx, eventId, doc.userId, mission, award);
  return { status: 'APPROVED' };
}

// ---------- organiser: content management ----------

export const MissionInputSchema = MissionSchema;

export async function saveMission(ctx: ServiceContext, eventId: string, actorId: string, raw: unknown): Promise<{ id: string; version: number }> {
  await requireCapability(ctx, eventId, actorId, 'field.manage');
  const parsed = MissionSchema.safeParse(raw);
  if (!parsed.success) throw new DomainError('VALIDATION_FAILED', parsed.error.issues.map((i) => i.message).join(' '));
  const m = parsed.data;
  if (m.xp > 0 && m.spaceId !== null) {
    const venue = await ctx.store.getVenue(eventId);
    if (!venue) throw new DomainError('VALIDATION_FAILED', 'This event has no venue map, so a mission cannot be placed on it.');
    if (!venue.spaces.some((s) => s.id === m.spaceId)) throw new DomainError('VALIDATION_FAILED', 'That place is not in the venue map.');
  }
  if (m.seasonId) await eventSeason(ctx, eventId, m.seasonId);
  if (m.verification.method === 'CHECK_IN') {
    const station = await ctx.store.docGet('fieldStations', m.verification.stationId);
    if (!station || station.eventId !== eventId) throw new DomainError('VALIDATION_FAILED', 'Set up that check-in station first.');
    if (m.spaceId !== null && station.spaceId !== m.spaceId) throw new DomainError('VALIDATION_FAILED', 'The check-in station must be in the mission’s place.');
  }
  for (const pre of m.prerequisiteIds) {
    const found = await ctx.store.docGet('fieldMissions', pre);
    if (!found || found.eventId !== eventId) throw new DomainError('VALIDATION_FAILED', `Prerequisite “${pre}” does not exist in this event.`);
  }
  const existing = await ctx.store.docGet('fieldMissions', m.id);
  if (existing && existing.eventId !== eventId) throw new DomainError('VALIDATION_FAILED', 'That mission id is already used.');
  const now = ctx.now();
  const doc: FieldMission = {
    ...m,
    eventId,
    source: m.source,
    maxCompletionsPerPerson: 1,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    version: (existing?.version ?? 0) + 1,
  };
  await ctx.store.docPut('fieldMissions', doc);
  await audit(ctx, eventId, actorId, existing ? 'field.mission.updated' : 'field.mission.created', 'mission', m.id, `${m.title} · ${m.xp} XP · ${m.status}`);
  return { id: m.id, version: doc.version };
}

export async function setMissionStatus(ctx: ServiceContext, eventId: string, actorId: string, missionId: string, status: 'PUBLISHED' | 'PAUSED'): Promise<void> {
  await requireCapability(ctx, eventId, actorId, 'field.manage');
  await eventMission(ctx, eventId, missionId);
  const now = ctx.now();
  await ctx.store.docMutate('fieldMissions', missionId, (d) => ({ ...d, status, updatedAt: now, version: d.version + 1 }));
  await audit(ctx, eventId, actorId, status === 'PUBLISHED' ? 'field.mission.published' : 'field.mission.paused', 'mission', missionId, `Status set to ${status}.`);
}

export const SeasonInputSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]{3,60}$/),
  year: z.number().int(),
  month: z.number().int(),
  title: z.string().trim().min(3).max(120),
  theme: z.string().trim().min(3).max(160),
  description: z.string().trim().min(10).max(600),
  artwork: z.enum(['compass', 'route', 'hands', 'lens', 'bridge']),
  bonusXp: z.number().int().min(0).max(1000),
  missionIds: z.array(z.string()).min(1).max(20),
  requiredMissionIds: z.array(z.string()).min(1).max(20),
  status: z.enum(['DRAFT', 'PUBLISHED', 'PAUSED']),
});

export async function saveSeason(ctx: ServiceContext, eventId: string, actorId: string, raw: unknown): Promise<{ id: string }> {
  await requireCapability(ctx, eventId, actorId, 'field.manage');
  const parsed = SeasonInputSchema.safeParse(raw);
  if (!parsed.success) throw new DomainError('VALIDATION_FAILED', parsed.error.issues.map((i) => i.message).join(' '));
  const s = parsed.data;
  let window;
  try {
    window = monthWindow(s.year, s.month);
  } catch (error: unknown) {
    throw new DomainError('VALIDATION_FAILED', error instanceof Error ? error.message : 'Invalid month.');
  }
  if (!s.requiredMissionIds.every((m) => s.missionIds.includes(m))) throw new DomainError('VALIDATION_FAILED', 'Every required mission must be in the season.');
  for (const m of s.missionIds) {
    const found = await ctx.store.docGet('fieldMissions', m);
    if (!found || found.eventId !== eventId) throw new DomainError('VALIDATION_FAILED', `Mission “${m}” does not exist in this event.`);
  }
  const existing = await ctx.store.docGet('fieldSeasons', s.id);
  if (existing && existing.eventId !== eventId) throw new DomainError('VALIDATION_FAILED', 'That season id is already used.');
  // Seasons that have already ended are history. Their dates and requirements can never change.
  if (existing && seasonPhase(existing, ctx.now()) === 'ENDED') throw new DomainError('VERSION_CONFLICT', 'An ended season is history and cannot be edited.');
  const now = ctx.now();
  const doc: FieldSeason = {
    id: s.id,
    eventId,
    year: s.year,
    month: s.month,
    title: s.title,
    theme: s.theme,
    description: s.description,
    startsAt: window.startsAt,
    endsAt: window.endsAt,
    artwork: s.artwork,
    bonusXp: s.bonusXp,
    missionIds: s.missionIds,
    requiredMissionIds: s.requiredMissionIds,
    status: s.status,
    source: 'ORGANISER',
    version: (existing?.version ?? 0) + 1,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  await ctx.store.docPut('fieldSeasons', doc);
  await audit(ctx, eventId, actorId, 'field.season.saved', 'season', s.id, `${s.title} · ${s.status}`);
  return { id: s.id };
}

export async function saveLevels(ctx: ServiceContext, eventId: string, actorId: string, raw: unknown): Promise<{ version: number }> {
  await requireCapability(ctx, eventId, actorId, 'field.manage');
  const parsed = LevelsSchema.safeParse(raw);
  if (!parsed.success) throw new DomainError('VALIDATION_FAILED', parsed.error.issues.map((i) => i.message).join(' '));
  const existing = await ctx.store.docGet('fieldLevels', eventId);
  const version = (existing?.version ?? 0) + 1;
  const config: FieldLevelConfig = { id: eventId, eventId, levels: parsed.data, version, updatedAt: ctx.now() };
  await ctx.store.docPut('fieldLevels', config);
  await audit(ctx, eventId, actorId, 'field.levels.saved', 'levels', eventId, `${parsed.data.length} levels, version ${version}.`);
  return { version };
}

export async function issueStation(ctx: ServiceContext, eventId: string, actorId: string, spaceId: string, name: string, stationId: string): Promise<{ id: string; code: string; expiresAt: number }> {
  await requireCapability(ctx, eventId, actorId, 'field.manage');
  const venue = await ctx.store.getVenue(eventId);
  if (!venue || !venue.spaces.some((s) => s.id === spaceId)) throw new DomainError('VALIDATION_FAILED', 'That place is not in the venue map.');
  const trimmed = name.trim();
  if (trimmed.length < 2 || trimmed.length > 80) throw new DomainError('VALIDATION_FAILED', 'Give the station a name of 2 to 80 characters.');
  if (!/^[a-z0-9-]{3,60}$/.test(stationId)) throw new DomainError('VALIDATION_FAILED', 'The station id may use lower-case letters, digits and hyphens.');
  const existing = await ctx.store.docGet('fieldStations', stationId);
  if (existing && existing.eventId !== eventId) throw new DomainError('VALIDATION_FAILED', 'That station id is already used.');
  const code = newCheckInCode();
  const now = ctx.now();
  const station: FieldStation = {
    id: stationId,
    eventId,
    spaceId,
    name: trimmed,
    codeHash: codeHash(stationId, code),
    codeIssuedAt: now,
    codeExpiresAt: now + CHECK_IN_CODE_TTL_MS,
    rotations: existing ? existing.rotations + 1 : 0,
    createdBy: actorId,
    version: (existing?.version ?? 0) + 1,
  };
  await ctx.store.docPut('fieldStations', station);
  await audit(ctx, eventId, actorId, existing ? 'field.station.rotated' : 'field.station.issued', 'station', stationId, `${trimmed}: new check-in code, valid 4 hours.`);
  return { id: stationId, code, expiresAt: station.codeExpiresAt };
}

/** Adds an audited ADJUSTMENT entry. Existing ledger entries are never edited or removed. */
export async function adjustXp(ctx: ServiceContext, eventId: string, actorId: string, userId: string, amount: number, reason: string): Promise<{ xp: number }> {
  await requireCapability(ctx, eventId, actorId, 'field.manage');
  if (!Number.isInteger(amount) || amount === 0 || Math.abs(amount) > 500) throw new DomainError('VALIDATION_FAILED', 'Adjust by a whole number of XP between 1 and 500, positive or negative.');
  const text = reason.trim();
  if (text.length < 10 || text.length > 300) throw new DomainError('VALIDATION_FAILED', 'Give a reason of 10 to 300 characters. It is kept in the audit trail.');
  const membership = await ctx.store.findMembership(eventId, userId);
  if (!membership) throw new DomainError('NOT_FOUND', 'That person is not in this event.');
  const entry: FieldLedgerEntry = { id: ctx.newId('adj'), eventId, userId, amount, kind: 'ADJUSTMENT', sourceId: actorId, reason: text, actorId, createdAt: ctx.now() };
  await ctx.store.docPut('fieldLedger', entry);
  await audit(ctx, eventId, actorId, 'field.xp.adjusted', 'user', userId, `${amount > 0 ? '+' : ''}${amount} XP: ${text}`);
  return { xp: (await playerState(ctx, eventId, userId)).xp };
}

export async function dismissFlag(ctx: ServiceContext, eventId: string, actorId: string, flagId: string): Promise<void> {
  await requireCapability(ctx, eventId, actorId, 'field.review');
  const flagged = await ctx.store.docMutate('fieldFlags', flagId, (f) => (f.eventId !== eventId || f.status !== 'OPEN' ? null : { ...f, status: 'DISMISSED' }));
  if (!flagged) throw new DomainError('NOT_FOUND', 'That flag is not open.');
  await audit(ctx, eventId, actorId, 'field.flag.dismissed', 'flag', flagId, 'Reviewed and dismissed. No award was changed.');
}

export interface ManageSnapshot {
  missions: Array<FieldMission & { started: number; approved: number; pending: number }>;
  seasons: FieldSeason[];
  levels: LevelDefinition[];
  stations: Array<Omit<FieldStation, 'codeHash'> & { codeExpiresAt: number }>;
  pendingReviews: Array<{ id: string; missionId: string; userId: string; text: string; submittedAt: number | null }>;
  flags: FieldFlag[];
  badgeCounts: Record<string, number>;
  totals: { participants: number; approvals: number; xpAwarded: number };
}

/** Organiser view. Counts are computed from real records. Private evidence is shown only to reviewers. */
export async function manageSnapshot(ctx: ServiceContext, eventId: string, actorId: string): Promise<ManageSnapshot> {
  await requireCapability(ctx, eventId, actorId, 'field.review');
  const [missions, seasons, levels, stations, attempts, flags, badges, ledger] = await Promise.all([
    ctx.store.docList('fieldMissions', { eventId }),
    ctx.store.docList('fieldSeasons', { eventId }),
    loadLevels(ctx, eventId),
    ctx.store.docList('fieldStations', { eventId }),
    ctx.store.docList('fieldAttempts', { eventId }),
    ctx.store.docList('fieldFlags', { eventId }),
    ctx.store.docList('fieldBadges', { eventId }),
    ctx.store.docList('fieldLedger', { eventId }),
  ]);
  const badgeCounts: Record<string, number> = {};
  for (const b of badges) badgeCounts[b.badgeId] = (badgeCounts[b.badgeId] ?? 0) + 1;
  return {
    missions: missions
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((m) => {
        const mine = attempts.filter((a) => a.missionId === m.id);
        return { ...m, started: mine.length, approved: mine.filter((a) => a.status === 'APPROVED').length, pending: mine.filter((a) => a.status === 'PENDING_REVIEW').length };
      }),
    seasons: seasons.sort((a, b) => a.startsAt - b.startsAt),
    levels: [...levels].sort((a, b) => a.minXp - b.minXp),
    stations: stations.map((s) => ({
      id: s.id,
      eventId: s.eventId,
      spaceId: s.spaceId,
      name: s.name,
      codeIssuedAt: s.codeIssuedAt,
      codeExpiresAt: s.codeExpiresAt,
      rotations: s.rotations,
      createdBy: s.createdBy,
      version: s.version,
    })),
    pendingReviews: attempts
      .filter((a) => a.status === 'PENDING_REVIEW' && (missions.find((m) => m.id === a.missionId)?.verification.method === 'MANUAL_REVIEW'))
      .map((a) => ({ id: a.id, missionId: a.missionId, userId: a.userId, text: a.evidenceText, submittedAt: a.submittedAt })),
    flags: flags.filter((f) => f.status === 'OPEN').sort((a, b) => b.createdAt - a.createdAt),
    badgeCounts,
    totals: {
      participants: new Set(attempts.map((a) => a.userId)).size,
      approvals: attempts.filter((a) => a.status === 'APPROVED').length,
      xpAwarded: ledger.reduce((s, e) => s + e.amount, 0),
    },
  };
}

// ---------- the badge cabinet ----------

export async function cabinetFor(ctx: ServiceContext, eventId: string, userId: string) {
  const [badges, state, seasons] = await Promise.all([badgesOf(ctx, eventId, userId), playerState(ctx, eventId, userId), seasonsForViewer(ctx, eventId, userId)]);
  const history = [...(await ctx.store.docList('fieldLedger', { eventId, userId }))]
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 50)
    .map((e) => ({ id: e.id, amount: e.amount, kind: e.kind, reason: e.reason, at: e.createdAt }));
  return {
    state,
    badges: badges.sort((a, b) => b.earnedAt - a.earnedAt).map((b) => ({ id: b.id, badgeId: b.badgeId, kind: b.kind, name: b.name, artwork: b.artwork, seasonId: b.seasonId, earnedAt: b.earnedAt })),
    achievementDefinitions: ACHIEVEMENTS,
    seasons,
    history,
  };
}

