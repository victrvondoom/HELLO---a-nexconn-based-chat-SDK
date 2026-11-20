import { z } from 'zod';
import { DomainError } from '../domain/errors';
import { requireCapability, audit, type ServiceContext } from './context';
import { findRoute } from '../domain/venue/route';
import type { Venue } from '../domain/venue/types';
import { MissionSchema, monthWindow, seasonPhase, type MissionCategory } from '../domain/field/rules';
import type { FieldMission, FieldSeason, QuestRun } from '../domain/product';
import { listMissionsForViewer, saveMission, type MissionView } from './field-atlas';
import { WORKFLOWS } from './workflows';
import { fieldConditions, fieldPulse } from './field-live';
import { conditionPenalty, pulsePenalty } from '../domain/field/live';

/**
 * QUEST DIRECTOR: the planning and explanation layer for Field Atlas.
 *
 * What it does:
 *  - Recommends a next mission from the person's real progress and the real venue graph (step-free routing when asked).
 *  - Answers questions about one mission, quoting the mission record it was built from.
 *  - Drafts a monthly season from real rooms, real workflows and real sessions. Anything it cannot ground is
 *    listed as unavailable instead of being invented.
 *
 * What it cannot do: award XP, verify evidence, change a mission's reward, or publish anything that is not low-risk.
 * It does not call a language model. Its outputs are deterministic and every line names the record it came from,
 * so the answers can be checked.
 */

export const GENERATOR_ID = 'QUEST_DIRECTOR_TEMPLATES_V1';
const AUTO_PUBLISH_MAX_XP = 50;

export interface Citation {
  /** `condition` cites the live field condition of a place; `pulse` cites the aggregate season pulse. */
  kind: 'mission' | 'space' | 'workflow' | 'season' | 'session' | 'condition' | 'pulse';
  id: string;
  field: string;
}

export interface Answer {
  question: string;
  text: string;
  citations: Citation[];
}

async function missionOrThrow(ctx: ServiceContext, eventId: string, missionId: string): Promise<FieldMission> {
  const m = /^[a-z0-9-]{3,60}$/.test(missionId) ? await ctx.store.docGet('fieldMissions', missionId) : null;
  if (!m || m.eventId !== eventId || m.status === 'DRAFT') throw new DomainError('NOT_FOUND', 'That mission does not exist.');
  return m;
}

function workflowName(id: string): string {
  return WORKFLOWS.find((w) => w.id === id)?.name ?? id;
}

function spaceName(venue: Venue | null, id: string | null): string | null {
  if (!id || !venue) return null;
  return venue.spaces.find((s) => s.id === id)?.name ?? null;
}

/**
 * Answers the questions a person asks about one mission. Every answer cites the mission field it used.
 * When a fact is not recorded (no venue, no estimate), the answer says so rather than guessing.
 */
export async function fieldGuide(ctx: ServiceContext, eventId: string, userId: string, missionId: string): Promise<{ answers: Answer[]; generator: string }> {
  await requireCapability(ctx, eventId, userId, 'event.read');
  const mission = await missionOrThrow(ctx, eventId, missionId);
  const venue = await ctx.store.getVenue(eventId);
  const views = await listMissionsForViewer(ctx, eventId, userId);
  const view = views.find((v) => v.id === mission.id) as MissionView;
  const place = spaceName(venue, mission.spaceId);
  const season = mission.seasonId ? await ctx.store.docGet('fieldSeasons', mission.seasonId) : null;
  const cite = (kind: Citation['kind'], id: string, field: string): Citation => ({ kind, id, field });

  const answers: Answer[] = [];
  answers.push({
    question: 'Why is this mission relevant?',
    text: mission.whyItMatters,
    citations: [cite('mission', mission.id, 'whyItMatters')],
  });
  answers.push({
    question: 'Where should I go?',
    text: mission.nonLocation
      ? 'This mission has no place in the venue. You complete it from wherever you are.'
      : place
        ? `${place}${venue ? ` (${venue.floors.find((f) => f.id === venue.spaces.find((s) => s.id === mission.spaceId)?.floor)?.name ?? 'venue floor'})` : ''}.`
        : 'The venue map does not place this mission, so staff can tell you where to go.',
    citations: [cite('mission', mission.id, mission.nonLocation ? 'nonLocation' : 'spaceId')],
  });
  answers.push({
    question: 'What should I do?',
    text: `${mission.description} ${view.verification.detail}`,
    citations: [cite('mission', mission.id, 'description'), cite('mission', mission.id, 'verification')],
  });
  const needs =
    mission.verification.method === 'WORKFLOW_RUN'
      ? `Run “${workflowName(mission.verification.workflowId)}” on the workflow canvas after you start the mission.`
      : mission.verification.method === 'CHECK_IN'
        ? 'A staff member at the station gives you a check-in code. The code expires, so ask for the current one.'
        : `Submit a description of what you did. ${mission.verification.evidencePrompt}`;
  answers.push({
    question: 'What do I need to complete it?',
    text: needs,
    citations: [cite('mission', mission.id, 'verification')],
  });
  answers.push({
    question: 'What happens after I complete it?',
    text: `You earn ${mission.xp} XP once it is verified.${season ? ` It counts toward “${season.title}”${season.requiredMissionIds.includes(mission.id) ? ', and it is one of the missions the badge requires' : ''}.` : ''}`,
    citations: [cite('mission', mission.id, 'xp'), ...(season ? [cite('season', season.id, 'requiredMissionIds')] : [])],
  });
  // Live: incidents, occupancy and the schedule for the mission's place, read now rather than at publish time.
  if (mission.spaceId) {
    const condition = (await fieldConditions(ctx, eventId, userId))[mission.spaceId];
    answers.push({
      question: 'Is now a good time to go?',
      text: !condition
        ? 'Nothing is reported there right now: no open issue, no crowding figure above 80%, no session running.'
        : `${condition.signals.map((sig) => sig.text).join(' ')}${condition.level === 'AVOID' ? ' Try another mission first and come back later.' : ''}`,
      citations: [cite('condition', mission.spaceId, condition ? condition.signals.map((sig) => sig.kind.toLowerCase()).join('+') : 'clear')],
    });
  }
  answers.push({
    question: 'Is there a more accessible route?',
    text: mission.accessibilityNote
      ? mission.accessibilityNote
      : 'No accessibility note is recorded for this mission. Ask staff at registration for a step-free route to the place.',
    citations: [cite('mission', mission.id, 'accessibilityNote')],
  });
  const next = views.filter((v) => v.id !== mission.id && v.availability.state === 'AVAILABLE' && v.attempt.status !== 'APPROVED' && v.prerequisiteIds.includes(mission.id));
  answers.push({
    question: 'Which related activity should I do next?',
    text: next.length > 0 ? `After this, try “${next[0]?.title ?? ''}”. It builds on this mission.` : 'No mission is set to build on this one yet.',
    citations: next.length > 0 ? [cite('mission', next[0]?.id ?? mission.id, 'prerequisiteIds')] : [],
  });
  return { answers, generator: GENERATOR_ID };
}

// ---------- recommendations ----------

export const RecommendSchema = z.object({
  minutes: z.number().int().min(5).max(480).nullable().default(null),
  startSpaceId: z.string().max(60).nullable().default(null),
  stepFree: z.boolean().default(false),
});

export interface Recommendation {
  missionId: string;
  title: string;
  reason: string;
  route: null | { metres: number; seconds: number; stepFree: boolean; steps: string[]; legs: Array<{ floor: number; points: Array<readonly [number, number]> }> };
  citations: Citation[];
}

/** The next useful missions for this person. Deterministic: ranks by fit, not by a guess about where they are. */
export async function recommendFor(
  ctx: ServiceContext,
  eventId: string,
  userId: string,
  input: z.infer<typeof RecommendSchema>,
): Promise<{ recommendations: Recommendation[]; routes: Record<string, NonNullable<Recommendation['route']>>; note: string; generator: string }> {
  await requireCapability(ctx, eventId, userId, 'event.read');
  const parsed = RecommendSchema.safeParse(input);
  if (!parsed.success) throw new DomainError('VALIDATION_FAILED', 'Check the time and place you entered.');
  const { minutes, startSpaceId, stepFree } = parsed.data;
  const venue = await ctx.store.getVenue(eventId);
  const views = (await listMissionsForViewer(ctx, eventId, userId)).filter((v) => v.availability.state === 'AVAILABLE' && v.attempt.status !== 'APPROVED' && v.attempt.status !== 'PENDING_REVIEW');
  if (views.length === 0) {
    return { recommendations: [], routes: {}, note: 'No mission is open to you right now. Missions unlock as your level and the event schedule allow.', generator: GENERATOR_ID };
  }
  const startSpace = startSpaceId && venue ? venue.spaces.find((s) => s.id === startSpaceId) ?? null : null;
  if (startSpaceId && !startSpace) throw new DomainError('VALIDATION_FAILED', 'That place is not on the venue map.');

  // The live layer: what is happening in each place now, and anonymous momentum. Both change between polls,
  // so the same request can rank differently a few minutes later. That is the point.
  const conditions = await fieldConditions(ctx, eventId, userId);
  const pulse = await fieldPulse(ctx, eventId, userId, null);
  const pulseOf = new Map(pulse.missions.map((p) => [p.missionId, p]));

  const scored = views.map((v) => {
    let score = 0;
    const reasons: string[] = [];
    const citations: Citation[] = [{ kind: 'mission', id: v.id, field: 'availability' }];
    if (minutes !== null && v.estimateMinutes !== null) {
      if (v.estimateMinutes <= minutes) {
        score += 2;
        reasons.push(`about ${v.estimateMinutes} minutes, within your ${minutes}`);
      } else score -= 2;
      citations.push({ kind: 'mission', id: v.id, field: 'estimateMinutes' });
    }
    const missionSpace = v.spaceId && venue ? venue.spaces.find((s) => s.id === v.spaceId) ?? null : null;
    let route: Recommendation['route'] = null;
    if (startSpace && missionSpace && venue) {
      const result = findRoute(venue, startSpace.nodeId, missionSpace.nodeId, { stepFree });
      if (result.ok) {
        route = {
          metres: Math.round(result.metres),
          seconds: Math.round(result.seconds),
          stepFree: result.stepFree,
          steps: result.steps,
          legs: result.legs.map((leg) => ({ floor: leg.floor, points: leg.points })),
        };
        score += Math.max(0, 3 - result.metres / 40);
        reasons.push(`about ${Math.round(result.metres)} m from ${startSpace.name}${stepFree ? ' by a step-free route' : ''}`);
        citations.push({ kind: 'space', id: missionSpace.id, field: 'nodeId' });
      } else if (stepFree) {
        score -= 4;
        reasons.push('no step-free route to this place');
      }
    } else if (v.nonLocation) {
      score += 1;
      reasons.push('can be done from anywhere');
    }
    const condition = v.spaceId ? conditions[v.spaceId] : undefined;
    if (condition) {
      score += conditionPenalty(condition, stepFree);
      if (condition.level !== 'CLEAR') reasons.push(condition.level === 'AVOID' ? 'busy or affected right now, so it is ranked lower' : 'a little busy right now');
      if (stepFree && condition.accessIssue) reasons.push('an access issue is reported there');
      citations.push({ kind: 'condition', id: condition.spaceId, field: 'level' });
    }
    const momentum = pulseOf.get(v.id);
    const momentumScore = pulsePenalty(momentum, condition);
    if (momentumScore !== 0 && momentum) {
      score += momentumScore;
      if (momentum.verifiedLastHour !== null) reasons.push(`${momentum.verifiedLastHour} people verified it in the last hour`);
      citations.push({ kind: 'pulse', id: v.id, field: 'verifiedLastHour' });
    }
    score += v.difficulty === 'EASY' ? 1 : 0;
    score += v.xp / 100;
    if (v.seasonId) reasons.push('part of the current monthly challenge');
    return { v, score, reasons, route, citations };
  });
  scored.sort((a, b) => b.score - a.score || a.v.id.localeCompare(b.v.id));
  const routes: Record<string, NonNullable<Recommendation['route']>> = {};
  for (const s of scored) if (s.route) routes[s.v.id] = s.route;
  const recommendations: Recommendation[] = scored.slice(0, 3).map((s) => ({
    missionId: s.v.id,
    title: s.v.title,
    reason: s.reasons.length > 0 ? `${s.v.xp} XP, ${s.reasons.join('; ')}.` : `${s.v.xp} XP. Nothing about your time or place changes the order.`,
    route: s.route,
    citations: s.citations,
  }));
  const live = Object.keys(conditions).length > 0 ? ' Live conditions (open issues, crowding, sessions) are taken into account.' : '';
  const note = startSpace
    ? `Ranked from the place you chose and the venue map.${live} Your location is not tracked.`
    : `No starting place chosen, so these are ranked by fit and reward.${live} Choose a place to get routes. Your location is not tracked.`;
  return { recommendations, routes, note, generator: GENERATOR_ID };
}

// ---------- monthly challenge drafting ----------

export const DraftInputSchema = z.object({
  year: z.number().int().min(2000).max(2200),
  month: z.number().int().min(1).max(12),
});

export interface DraftOutcome {
  run: QuestRun;
  seasonId: string;
  created: number;
  autoPublished: number;
  unavailable: string[];
}

/**
 * Drafts one month's missions. Each draft is built from a real room (a place on the venue map with a room
 * record), a real workflow, or a real session. A draft that needs a check-in station is skipped and listed as
 * unavailable when no station exists. Drafts are validated against MissionSchema before they are saved.
 * Only low-risk drafts (small XP, workflow-verified, not in a community) publish themselves.
 */
export async function draftMonthlyChallenge(ctx: ServiceContext, eventId: string, actorId: string, input: z.infer<typeof DraftInputSchema>): Promise<DraftOutcome> {
  await requireCapability(ctx, eventId, actorId, 'field.manage');
  const parsed = DraftInputSchema.safeParse(input);
  if (!parsed.success) throw new DomainError('VALIDATION_FAILED', 'Choose a valid year and month.');
  const timeZone = (await ctx.store.getEvent(eventId))?.timezone ?? 'UTC';
  const window = monthWindow(parsed.data.year, parsed.data.month, timeZone);
  const seasonId = `season-${parsed.data.year}-${String(parsed.data.month).padStart(2, '0')}`;
  const venue = await ctx.store.getVenue(eventId);
  const [rooms, sessions, stations, existingSeason] = await Promise.all([
    ctx.store.listRooms(eventId),
    ctx.store.listSessions(eventId),
    ctx.store.docList('fieldStations', { eventId }),
    ctx.store.docGet('fieldSeasons', seasonId),
  ]);
  const unavailable: string[] = [];
  if (!venue) unavailable.push('venue map: no map is drawn, so no mission can be placed. Draft is non-location only.');
  if (rooms.length === 0) unavailable.push('rooms: none are recorded for this event.');
  if (sessions.length === 0) unavailable.push('sessions: none are scheduled, so no session missions were drafted.');
  if (stations.length === 0) unavailable.push('check-in stations: none are set up, so check-in missions cannot be verified and were not drafted.');
  if (seasonPhase(window, ctx.now()) === 'ENDED') throw new DomainError('VERSION_CONFLICT', 'That month has ended. Its challenge is history.');

  const drafts: FieldMission[] = [];
  const now = ctx.now();
  const make = (partial: Omit<FieldMission, 'eventId' | 'createdAt' | 'updatedAt' | 'version' | 'source' | 'maxCompletionsPerPerson' | 'status' | 'seasonId' | 'estimateMinutes' | 'endsAt' | 'startsAt' | 'accessibilityNote' | 'nonLocation' | 'prerequisiteIds' | 'requiredLevel'> & Partial<FieldMission>): FieldMission => ({
    eventId,
    status: 'DRAFT',
    maxCompletionsPerPerson: 1,
    source: 'QUEST_DIRECTOR',
    seasonId,
    estimateMinutes: 15,
    startsAt: window.startsAt,
    endsAt: window.endsAt,
    accessibilityNote: 'Step-free route available on request from staff at registration.',
    nonLocation: false,
    prerequisiteIds: [],
    requiredLevel: 0,
    createdAt: now,
    updatedAt: now,
    version: 1,
    ...partial,
  });

  // 1. A "plan your day" mission: real workflow, no place. Low-risk, so it may publish itself.
  drafts.push(
    make({
      id: `${seasonId}-plan-day`,
      title: 'Plan your day',
      description: 'Run the day planner. It reads the schedule and your open requests and sends you a summary.',
      whyItMatters: 'Knowing what is on next and what is still open makes the rest of the event easier to use.',
      category: 'PARTICIPATION',
      difficulty: 'EASY',
      xp: 25,
      spaceId: null,
      nonLocation: true,
      verification: { method: 'WORKFLOW_RUN', workflowId: 'my-day' },
      estimateMinutes: 5,
    }),
  );

  // 2. Place-based check-in missions, only where a station already exists in that place.
  for (const room of rooms.slice(0, 4)) {
    const space = venue?.spaces.find((s) => s.roomId === room.id) ?? null;
    if (!space) continue;
    const station = stations.find((st) => st.spaceId === space.id);
    if (!station) {
      unavailable.push(`check-in station for ${room.name}: none set up, so no mission was drafted for it.`);
      continue;
    }
    drafts.push(
      make({
        id: `${seasonId}-visit-${room.id}`,
        title: `Visit ${room.name}`,
        description: `Go to ${room.name} and check in at the station there. Staff give you the current code.`,
        whyItMatters: `${room.name} hosts sessions during the event. Finding it is the first step to attending them.`,
        category: 'EXPLORATION',
        difficulty: 'EASY',
        xp: 40,
        spaceId: space.id,
        verification: { method: 'CHECK_IN', stationId: station.id },
        estimateMinutes: 10,
      }),
    );
  }

  // 3. A contribution mission that needs a person to judge the evidence.
  drafts.push(
    make({
      id: `${seasonId}-connect`,
      title: 'Introduce yourself to a new person',
      description: 'Start a conversation with someone you have not met at this event, then describe it.',
      whyItMatters: 'Introductions help people find the others they need during the event.',
      category: 'CONNECTION',
      difficulty: 'MEDIUM',
      xp: 60,
      spaceId: null,
      nonLocation: true,
      verification: { method: 'MANUAL_REVIEW', evidencePrompt: 'Say who you met and what you talked about, in your own words.' },
      estimateMinutes: 20,
      requiredLevel: 1,
    }),
  );

  const season: FieldSeason = {
    id: seasonId,
    eventId,
    year: parsed.data.year,
    month: parsed.data.month,
    title: `${new Date(window.startsAt).toLocaleString('en-GB', { month: 'long', timeZone })} Field Challenge`,
    theme: 'Find your way in, then help the next person.',
    description: 'A monthly collection drafted from this event’s real rooms, workflows and schedule. Staff review it before it is shown to attendees.',
    startsAt: window.startsAt,
    endsAt: window.endsAt,
    artwork: 'compass',
    bonusXp: 100,
    // Filled in after the missions are saved (below): the season lists only missions that exist.
    missionIds: drafts.map((d) => d.id),
    requiredMissionIds: drafts.map((d) => d.id),
    status: 'DRAFT',
    source: 'QUEST_DIRECTOR',
    version: 1,
    createdAt: now,
    updatedAt: now,
  };

  if (!existingSeason) await ctx.store.docPut('fieldSeasons', season);

  const autoPublished: string[] = [];
  const created: string[] = [];
  for (const d of drafts) {
    const lowRisk = d.xp <= AUTO_PUBLISH_MAX_XP && d.verification.method === 'WORKFLOW_RUN' && (d.spaceId !== null || d.nonLocation) && d.requiredLevel === 0;
    const candidate = { ...d, status: lowRisk ? 'PUBLISHED' : 'DRAFT' } as const;
    const check = MissionSchema.safeParse({ ...candidate, source: 'QUEST_DIRECTOR' });
    if (!check.success) {
      unavailable.push(`draft “${d.title}” was rejected by validation: ${check.error.issues.map((i) => i.message).join(' ')}`);
      continue;
    }
    if (existingSeason && (await ctx.store.docGet('fieldMissions', d.id))) continue;
    await saveMission(ctx, eventId, actorId, { ...check.data, status: candidate.status });
    created.push(d.id);
    if (lowRisk) autoPublished.push(d.id);
  }
  // The season lists only the missions that were actually saved. Manual-review missions are optional: a badge
  // must not wait on an organiser's queue.
  const requiredOf = (ids: string[]) => drafts.filter((d) => ids.includes(d.id) && d.verification.method !== 'MANUAL_REVIEW').map((d) => d.id);
  if (!existingSeason) {
    await ctx.store.docMutate('fieldSeasons', seasonId, (current) => ({
      ...current,
      missionIds: created,
      requiredMissionIds: requiredOf(created),
      version: current.version + 1,
      updatedAt: now,
    }));
  } else if (created.length > 0) {
    // A re-draft (for example after a new check-in station was set up) used to save its new missions with
    // this seasonId but leave them out of the season, so they were invisible in the challenge. They are now
    // appended. Requirements change only while the season is still a draft, so a published challenge never
    // becomes harder for people who are part-way through it.
    await ctx.store.docMutate('fieldSeasons', seasonId, (current) => ({
      ...current,
      missionIds: [...current.missionIds, ...created.filter((id) => !current.missionIds.includes(id))],
      requiredMissionIds: current.status === 'DRAFT' ? [...current.requiredMissionIds, ...requiredOf(created).filter((id) => !current.requiredMissionIds.includes(id))] : current.requiredMissionIds,
      version: current.version + 1,
      updatedAt: now,
    }));
  }
  const run: QuestRun = {
    id: ctx.newId('qrun'),
    eventId,
    createdAt: now,
    createdBy: actorId,
    sources: {
      sessionIds: sessions.map((s) => s.id),
      roomIds: rooms.map((r) => r.id),
      spaceIds: venue ? venue.spaces.map((s) => s.id) : [],
      workflowIds: ['my-day'],
    },
    unavailable,
    missionIds: created,
    autoPublished,
    status: created.length > 0 ? 'DRAFT_CREATED' : 'REJECTED_ALL',
  };
  await ctx.store.docPut('questRuns', run);
  await audit(ctx, eventId, actorId, 'field.quest.drafted', 'season', seasonId, `${created.length} drafts, ${autoPublished.length} auto-published, ${unavailable.length} gaps.`);
  return { run, seasonId, created: created.length, autoPublished: autoPublished.length, unavailable };
}

export const CATEGORY_LABEL: Record<MissionCategory, string> = {
  EXPLORATION: 'Exploration',
  PARTICIPATION: 'Participation',
  CONTRIBUTION: 'Contribution',
  CONNECTION: 'Connection',
  COORDINATION: 'Coordination',
};

