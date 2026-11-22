import { z } from 'zod';
import { DomainError } from '@/domain/errors';
import { AV_LABEL, AV_THRESHOLD, AV_WINDOW_MS, aggregateAv } from '@/domain/companion/av';
import { freeSeats, rankPlanB, type PlanBOption } from '@/domain/companion/planb';
import { groupFor } from '@/domain/companion/questions';
import type { AvSignal, AvSignalKind, LiveQuestion, PersonalPlan, SeatLedger } from '@/domain/product';
import type { Room, Session } from '@/domain/types';
import { findRoute } from '@/domain/venue/route';
import type { Venue } from '@/domain/venue/types';
import { isOpen } from '@/domain/incidents/lifecycle';
import { requireCapability, type ServiceContext } from './context';
import { ingestReport } from './incidents';
import { discoverPeople } from './people';

/**
 * The event companion's live layer: the personal plan, the live session room (questions, "can't hear" and
 * "can't see"), Plan B with seat holds, the care panel, and the staff venue board. All of it uses the event's
 * own session and room records; nothing here keeps a copy of them.
 */

export const HOLD_MS = 10 * 60_000;
export const SignalSchema = z.object({ kind: z.enum(['CANT_HEAR', 'CANT_SEE']) });
export const BetterSchema = z.object({ kind: z.enum(['CANT_HEAR', 'CANT_SEE']), better: z.boolean() });
export const QuestionSchema = z.object({ text: z.string().trim().min(3).max(280) });
export const PlanSchema = z.object({ sessionIds: z.array(z.string().min(1).max(80)).max(40), stepFree: z.boolean() });

const planId = (eventId: string, userId: string) => `${eventId}:${userId}`;

export async function getPlan(ctx: ServiceContext, eventId: string, userId: string): Promise<PersonalPlan> {
  await requireCapability(ctx, eventId, userId, 'event.read');
  return (await ctx.store.docGet('plans', planId(eventId, userId))) ?? { id: planId(eventId, userId), eventId, userId, sessionIds: [], stepFree: false, updatedAt: 0 };
}

export async function savePlan(ctx: ServiceContext, eventId: string, userId: string, input: z.infer<typeof PlanSchema>): Promise<PersonalPlan> {
  await requireCapability(ctx, eventId, userId, 'event.read');
  const known = new Set((await ctx.store.listSessions(eventId)).map((s) => s.id));
  const plan: PersonalPlan = { id: planId(eventId, userId), eventId, userId, sessionIds: [...new Set(input.sessionIds.filter((id) => known.has(id)))], stepFree: input.stepFree, updatedAt: ctx.now() };
  await ctx.store.docPut('plans', plan);
  return plan;
}

export async function togglePlanned(ctx: ServiceContext, eventId: string, userId: string, sessionId: string): Promise<PersonalPlan> {
  const plan = await getPlan(ctx, eventId, userId);
  const sessionIds = plan.sessionIds.includes(sessionId) ? plan.sessionIds.filter((id) => id !== sessionId) : [...plan.sessionIds, sessionId];
  return savePlan(ctx, eventId, userId, { sessionIds, stepFree: plan.stepFree });
}

async function sessionIn(ctx: ServiceContext, eventId: string, sessionId: string): Promise<{ session: Session; room: Room | null }> {
  const session = await ctx.store.getSession(sessionId);
  if (!session || session.eventId !== eventId) throw new DomainError('NOT_FOUND', 'Session not found.');
  return { session, room: await ctx.store.getRoom(session.roomId) };
}

// --- live room ---

export async function liveRoom(ctx: ServiceContext, eventId: string, userId: string, sessionId: string) {
  const membership = await requireCapability(ctx, eventId, userId, 'event.read');
  const { session, room } = await sessionIn(ctx, eventId, sessionId);
  const now = ctx.now();
  const [speaker, questions, signals, plan] = await Promise.all([
    session.speakerUserId ? ctx.store.getUser(session.speakerUserId) : Promise.resolve(null),
    ctx.store.docList('liveQuestions', { sessionId }),
    ctx.store.docList('avSignals', { sessionId }),
    getPlan(ctx, eventId, userId),
  ]);
  const staffish = membership.role === 'ORGANISER' || membership.role === 'OPERATIONS_STAFF' || membership.role === 'VOLUNTEER' || session.speakerUserId === userId;
  // Questions are grouped; authors are never shown to other attendees.
  const groups = new Map<string, { key: string; questions: Array<{ id: string; text: string; mine: boolean; votes: number; voted: boolean; answered: boolean }> }>();
  for (const q of [...questions].sort((a, b) => a.createdAt - b.createdAt)) {
    const g = groups.get(q.groupKey) ?? { key: q.groupKey, questions: [] };
    g.questions.push({ id: q.id, text: q.text, mine: q.authorId === userId, votes: q.votes.length, voted: q.votes.includes(userId), answered: q.answered });
    groups.set(q.groupKey, g);
  }
  const mine = signals.filter((s) => s.userId === userId);
  const incidentIds = [...new Set(mine.map((s) => s.incidentId).filter((x): x is string => x !== null))];
  const incidents = await Promise.all(incidentIds.map((id) => ctx.store.getIncident(id)));
  const myAv = mine.map((s) => {
    const incident = incidents.find((i) => i?.id === s.incidentId) ?? null;
    return {
      kind: s.kind,
      at: s.at,
      state: s.better === true ? 'BETTER' : !incident ? 'SENT' : isOpen(incident.status) ? 'WITH_AV_TEAM' : 'FIXED_ASK',
    } as const;
  });
  const running = session.startsAt <= now && now < session.endsAt;
  return {
    now,
    session: { id: session.id, title: session.title, topics: session.topics, startsAt: session.startsAt, endsAt: session.endsAt, capacity: session.capacity, enrolled: session.enrolled, accessible: session.accessible },
    room: room ? { id: room.id, name: room.name, zone: room.zone, accessible: room.accessible } : null,
    speaker: speaker ? { id: speaker.id, name: speaker.displayName } : null,
    running,
    planned: plan.sessionIds.includes(session.id),
    // No caption, audio or slide provider is configured in this build: say so instead of pretending.
    media: { captions: 'NOT_CONFIGURED', audio: 'NOT_CONFIGURED', slides: 'NONE_SHARED' } as const,
    questions: [...groups.values()].sort((a, b) => b.questions.reduce((n, q) => n + q.votes, 0) - a.questions.reduce((n, q) => n + q.votes, 0) || b.questions.length - a.questions.length),
    myAv,
    staff: staffish ? { avDistinct: { CANT_HEAR: aggregateAv(signals, sessionId, 'CANT_HEAR', now).distinct, CANT_SEE: aggregateAv(signals, sessionId, 'CANT_SEE', now).distinct } } : null,
  };
}

export type LiveRoom = Awaited<ReturnType<typeof liveRoom>>;

/**
 * "Can't hear" / "Can't see". The person's signal is one document, so repeated taps never count twice.
 * When three distinct people report the same problem within 60 seconds, one AV report is filed through the
 * normal incident pipeline, whose duplicate gates attach later crossings to the same open incident.
 */
export async function signalAv(ctx: ServiceContext, eventId: string, userId: string, sessionId: string, kind: AvSignalKind): Promise<{ distinct: number; raised: boolean; incidentId: string | null }> {
  await requireCapability(ctx, eventId, userId, 'incident.report');
  const { session, room } = await sessionIn(ctx, eventId, sessionId);
  const now = ctx.now();
  if (!(session.startsAt - 10 * 60_000 <= now && now < session.endsAt)) throw new DomainError('INELIGIBLE', 'This session is not running now.');
  if (!room) throw new DomainError('NOT_FOUND', 'This session has no room.');
  const signal: AvSignal = { id: `${sessionId}:${kind}:${userId}`, eventId, sessionId, roomId: room.id, kind, userId, at: now, incidentId: null, better: null };
  await ctx.store.docPut('avSignals', signal);

  const decision = aggregateAv(await ctx.store.docList('avSignals', { sessionId }), sessionId, kind, now, AV_THRESHOLD, AV_WINDOW_MS);
  if (!decision.raise) return { distinct: decision.distinct, raised: false, incidentId: null };

  // Claim the uncounted signals first, so two simultaneous taps cannot file two reports for the same people.
  const claimed: string[] = [];
  const claim = `pending:${now}:${userId}`;
  for (const uid of decision.uncounted) {
    const won = await ctx.store.docMutate('avSignals', `${sessionId}:${kind}:${uid}`, (s) => (s.incidentId === null ? { ...s, incidentId: claim } : null));
    if (won) claimed.push(uid);
  }
  if (claimed.length < AV_THRESHOLD) {
    for (const uid of claimed) await ctx.store.docMutate('avSignals', `${sessionId}:${kind}:${uid}`, (s) => (s.incidentId === claim ? { ...s, incidentId: null } : null));
    return { distinct: decision.distinct, raised: false, incidentId: null };
  }
  const equipment = kind === 'CANT_HEAR' ? ['microphone'] : ['projector'];
  const result = await ingestReport(ctx, {
    eventId,
    reporterUserId: userId,
    text: `${claimed.length} people in ${room.name} reported they ${AV_LABEL[kind]} during "${session.title}" within ${AV_WINDOW_MS / 1000} seconds.`,
    category: 'AV',
    urgency: 'HIGH',
    roomId: room.id,
    roomName: room.name,
    equipment,
    overcrowded: false,
  });
  for (const uid of claimed) await ctx.store.docMutate('avSignals', `${sessionId}:${kind}:${uid}`, (s) => (s.incidentId === claim ? { ...s, incidentId: result.incident.id } : null));
  return { distinct: decision.distinct, raised: true, incidentId: result.incident.id };
}

/** "Better now?" after a repair. "Still bad" is a fresh signal, so three of them raise the problem again. */
export async function answerBetter(ctx: ServiceContext, eventId: string, userId: string, sessionId: string, kind: AvSignalKind, better: boolean): Promise<void> {
  await requireCapability(ctx, eventId, userId, 'incident.report');
  const id = `${sessionId}:${kind}:${userId}`;
  const existing = await ctx.store.docGet('avSignals', id);
  if (!existing || existing.eventId !== eventId) throw new DomainError('NOT_FOUND', 'You have not reported this.');
  if (better) {
    await ctx.store.docMutate('avSignals', id, (s) => ({ ...s, better: true }));
    return;
  }
  await ctx.store.docPut('avSignals', { ...existing, incidentId: null, better: null, at: ctx.now() - 1 });
  await signalAv(ctx, eventId, userId, sessionId, kind);
}

export async function askQuestion(ctx: ServiceContext, eventId: string, userId: string, sessionId: string, text: string): Promise<LiveQuestion> {
  await requireCapability(ctx, eventId, userId, 'message.send');
  await sessionIn(ctx, eventId, sessionId);
  const existing = await ctx.store.docList('liveQuestions', { sessionId });
  if (existing.filter((q) => q.authorId === userId && !q.answered).length >= 5) throw new DomainError('RATE_LIMITED', 'You have five open questions in this session. Wait for an answer first.');
  const question: LiveQuestion = { id: ctx.newId('q'), eventId, sessionId, authorId: userId, text, groupKey: groupFor(text, [...new Set(existing.map((q) => q.groupKey))]), votes: [userId], createdAt: ctx.now(), answered: false };
  await ctx.store.docPut('liveQuestions', question);
  return question;
}

export async function voteQuestion(ctx: ServiceContext, eventId: string, userId: string, questionId: string): Promise<void> {
  await requireCapability(ctx, eventId, userId, 'event.read');
  const q = await ctx.store.docMutate('liveQuestions', questionId, (doc) => (doc.eventId !== eventId ? null : { ...doc, votes: doc.votes.includes(userId) ? doc.votes.filter((v) => v !== userId) : [...doc.votes, userId] }));
  if (!q) throw new DomainError('NOT_FOUND', 'Question not found.');
}

// --- seats and Plan B ---

async function ledger(ctx: ServiceContext, session: Session): Promise<SeatLedger> {
  const blank: SeatLedger = { id: session.id, eventId: session.eventId, sessionId: session.id, holds: {}, closed: false };
  await ctx.store.docPutIfAbsent('seatLedgers', blank);
  return (await ctx.store.docGet('seatLedgers', session.id)) ?? blank;
}

const prune = (holds: Record<string, number>, now: number) => Object.fromEntries(Object.entries(holds).filter(([, until]) => until > now));

/**
 * Holds one seat for HOLD_MS. The check and the write are one conditional docMutate on the session's ledger,
 * so concurrent holds can never exceed the free seats. A hold is confirmed only when this returns.
 */
export async function holdSeat(ctx: ServiceContext, eventId: string, userId: string, sessionId: string): Promise<{ sessionId: string; expiresAt: number; free: number }> {
  await requireCapability(ctx, eventId, userId, 'session.read');
  const { session } = await sessionIn(ctx, eventId, sessionId);
  const now = ctx.now();
  if (session.endsAt <= now) throw new DomainError('INELIGIBLE', 'This session has ended.');
  await ledger(ctx, session);
  const why: { refusal: 'CLOSED' | 'FULL' | null } = { refusal: null };
  const updated = await ctx.store.docMutate('seatLedgers', sessionId, (l) => {
    const holds = prune(l.holds, now);
    if (l.closed) { why.refusal = 'CLOSED'; return null; }
    if (!(userId in holds) && freeSeats(session, holds, now) <= 0) { why.refusal = 'FULL'; return null; }
    return { ...l, holds: { ...holds, [userId]: now + HOLD_MS } };
  });
  if (!updated) throw new DomainError('INELIGIBLE', why.refusal === 'CLOSED' ? 'Staff have marked this room full.' : 'No seats are free in this session any more.');
  return { sessionId, expiresAt: updated.holds[userId] ?? now + HOLD_MS, free: freeSeats(session, updated.holds, now) };
}

export async function releaseSeat(ctx: ServiceContext, eventId: string, userId: string, sessionId: string): Promise<void> {
  await requireCapability(ctx, eventId, userId, 'session.read');
  await ctx.store.docMutate('seatLedgers', sessionId, (l) => (l.eventId === eventId && userId in l.holds ? { ...l, holds: Object.fromEntries(Object.entries(l.holds).filter(([uid]) => uid !== userId)) } : null));
}

/** Staff: mark a room full (or open it again). The room-full QR then sends people to their own Plan B. */
export async function setRoomFull(ctx: ServiceContext, eventId: string, userId: string, sessionId: string, closed: boolean): Promise<void> {
  await requireCapability(ctx, eventId, userId, 'incident.read.operational');
  const { session } = await sessionIn(ctx, eventId, sessionId);
  await ledger(ctx, session);
  await ctx.store.docMutate('seatLedgers', sessionId, (l) => ({ ...l, closed }));
}

function walkFrom(venue: Venue | null, fromRoomId: string | null, rooms: Room[], stepFree: boolean): Record<string, number> {
  const out: Record<string, number> = {};
  const nodeOf = (roomId: string) => venue?.spaces.find((sp) => sp.roomId === roomId)?.nodeId ?? null;
  const origin = fromRoomId ? nodeOf(fromRoomId) : null;
  for (const r of rooms) {
    if (r.id === fromRoomId) { out[r.id] = 1; continue; }
    const target = nodeOf(r.id);
    if (!venue || !origin || !target) { out[r.id] = 5; continue; }
    const route = findRoute(venue, origin, target, { stepFree });
    if (route.ok) out[r.id] = Math.max(1, Math.round(route.seconds / 60));
  }
  return out;
}

export async function planB(ctx: ServiceContext, eventId: string, userId: string, replacing: string | null): Promise<{ options: PlanBOption[]; replacing: { id: string; title: string; closed: boolean; free: number } | null; holds: Array<{ sessionId: string; expiresAt: number }> }> {
  await requireCapability(ctx, eventId, userId, 'session.discover');
  const now = ctx.now();
  const [sessions, rooms, ledgers, plan, venue] = await Promise.all([ctx.store.listSessions(eventId), ctx.store.listRooms(eventId), ctx.store.docList('seatLedgers', { eventId }), getPlan(ctx, eventId, userId), ctx.store.getVenue(eventId)]);
  const byId = new Map(sessions.map((s) => [s.id, s] as const));
  const ledgerOf = new Map(ledgers.map((l) => [l.sessionId, l] as const));
  const target = replacing ? byId.get(replacing) ?? null : null;
  const planned = plan.sessionIds.map((id) => byId.get(id)).filter((s): s is Session => Boolean(s));
  const seats = Object.fromEntries(sessions.map((s) => [s.id, freeSeats(s, ledgerOf.get(s.id)?.holds ?? {}, now)]));
  const ranked = rankPlanB({
    now,
    sessions,
    rooms,
    topics: [...(target?.topics ?? []), ...planned.flatMap((s) => s.topics)],
    planned,
    replacing,
    stepFree: plan.stepFree,
    seats,
    walkMinutes: walkFrom(venue, target?.roomId ?? null, rooms, plan.stepFree),
    closedSessions: new Set(ledgers.filter((l) => l.closed).map((l) => l.sessionId)),
  });
  const holds = ledgers.flatMap((l) => ((l.holds[userId] ?? 0) > now ? [{ sessionId: l.sessionId, expiresAt: l.holds[userId] as number }] : []));
  return {
    options: ranked.options.slice(0, 4),
    replacing: target ? { id: target.id, title: target.title, closed: ledgerOf.get(target.id)?.closed ?? false, free: seats[target.id] ?? 0 } : null,
    holds,
  };
}

// --- the LIVE hub and Today ---

export async function happeningNow(ctx: ServiceContext, eventId: string, userId: string) {
  await requireCapability(ctx, eventId, userId, 'event.read');
  const now = ctx.now();
  const [sessions, rooms, plan] = await Promise.all([ctx.store.listSessions(eventId), ctx.store.listRooms(eventId), getPlan(ctx, eventId, userId)]);
  const roomName = new Map(rooms.map((r) => [r.id, r.name] as const));
  const row = (s: Session) => ({ id: s.id, title: s.title, room: roomName.get(s.roomId) ?? '', startsAt: s.startsAt, endsAt: s.endsAt, planned: plan.sessionIds.includes(s.id) });
  return {
    now,
    live: sessions.filter((s) => s.startsAt <= now && now < s.endsAt).sort((a, b) => a.startsAt - b.startsAt).map(row),
    next: sessions.filter((s) => s.startsAt > now).sort((a, b) => a.startsAt - b.startsAt).slice(0, 6).map(row),
  };
}

/** The care panel: quiet room, toilets, step-free entrance, help points. Cached on the device for offline use. */
export async function careInfo(ctx: ServiceContext, eventId: string, userId: string) {
  await requireCapability(ctx, eventId, userId, 'event.read');
  const venue = await ctx.store.getVenue(eventId);
  const floorName = (f: number) => venue?.floors.find((x) => x.id === f)?.name ?? (f === 0 ? 'Ground floor' : `Floor ${f}`);
  return {
    quiet: (venue?.spaces ?? []).filter((s) => s.kind === 'QUIET').map((s) => ({ name: s.name, floor: floorName(s.floor), stepFree: s.stepFree })),
    toilets: (venue?.pois ?? []).filter((p) => p.kind === 'TOILETS').map((p) => ({ name: p.name, floor: floorName(p.floor) })),
    stepFree: (venue?.pois ?? []).filter((p) => p.kind === 'ACCESSIBLE_ENTRANCE' || p.kind === 'LIFT').map((p) => ({ name: p.name, floor: floorName(p.floor) })),
    help: (venue?.pois ?? []).filter((p) => p.kind === 'FIRST_AID' || p.kind === 'REGISTRATION').map((p) => ({ name: p.name, floor: floorName(p.floor) })),
  };
}

export async function todaySummary(ctx: ServiceContext, eventId: string, userId: string) {
  await requireCapability(ctx, eventId, userId, 'event.read');
  const now = ctx.now();
  const [sessions, rooms, plan, notifications, user] = await Promise.all([ctx.store.listSessions(eventId), ctx.store.listRooms(eventId), getPlan(ctx, eventId, userId), ctx.store.listNotifications(userId), ctx.store.getUser(userId)]);
  const roomOf = new Map(rooms.map((r) => [r.id, r] as const));
  const upcoming = sessions.filter((s) => s.endsAt > now).sort((a, b) => a.startsAt - b.startsAt);
  const mine = upcoming.filter((s) => plan.sessionIds.includes(s.id));
  const next = mine[0] ?? null;
  const changes = notifications.filter((n) => n.eventId === eventId && n.kind === 'SCHEDULE_CHANGE').sort((a, b) => b.createdAt - a.createdAt).slice(0, 3);
  const ledgerNext = next ? await ctx.store.docGet('seatLedgers', next.id) : null;
  const nextFull = next ? ledgerNext?.closed === true || freeSeats(next, ledgerNext?.holds ?? {}, now) <= 0 : false;
  const alternatives = next && nextFull ? (await planB(ctx, eventId, userId, next.id)).options.slice(0, 1) : [];

  // People worth meeting: listed speakers of sessions you chose, then people whose declared interests match
  // yours. Every suggestion says why; nothing is inferred beyond what people declared.
  const people: Array<{ userId: string; name: string; why: string }> = [];
  for (const s of mine) {
    if (s.speakerUserId && s.speakerUserId !== userId && !people.some((p) => p.userId === s.speakerUserId)) {
      const sp = await ctx.store.getUser(s.speakerUserId);
      if (sp) people.push({ userId: sp.id, name: sp.displayName, why: `Speaking at "${s.title}", which is in your plan.` });
    }
  }
  const interests = [...new Set([...(user?.interests ?? []), ...mine.flatMap((s) => s.topics)])];
  if (interests.length > 0) {
    try {
      for (const m of await discoverPeople(ctx, eventId, userId, interests.join(' '))) {
        if (people.length >= 3) break;
        if (!people.some((p) => p.userId === m.userId)) people.push({ userId: m.userId, name: m.displayName, why: `Also interested in ${m.matchedInterests.slice(0, 2).join(' and ')}.` });
      }
    } catch {
      /* people discovery is not available to every role */
    }
  }

  const row = (s: Session) => ({ id: s.id, title: s.title, room: roomOf.get(s.roomId)?.name ?? '', startsAt: s.startsAt, endsAt: s.endsAt, live: s.startsAt <= now && now < s.endsAt });
  return {
    now,
    next: next ? { ...row(next), full: nextFull } : null,
    agenda: mine.slice(0, 5).map(row),
    suggestions: mine.length === 0 ? upcoming.slice(0, 3).map(row) : [],
    changes: changes.map((n) => ({ id: n.id, body: n.body, at: n.createdAt })),
    alternative: alternatives[0] ?? null,
    people: people.slice(0, 3),
  };
}

// --- staff venue board ---

export async function venueBoard(ctx: ServiceContext, eventId: string, userId: string) {
  await requireCapability(ctx, eventId, userId, 'incident.read.operational');
  const now = ctx.now();
  const [sessions, rooms, ledgers, signals, incidents] = await Promise.all([ctx.store.listSessions(eventId), ctx.store.listRooms(eventId), ctx.store.docList('seatLedgers', { eventId }), ctx.store.docList('avSignals', { eventId }), ctx.store.listIncidents(eventId)]);
  const roomOf = new Map(rooms.map((r) => [r.id, r] as const));
  const ledgerOf = new Map(ledgers.map((l) => [l.sessionId, l] as const));
  return sessions
    .filter((s) => s.endsAt > now)
    .sort((a, b) => a.startsAt - b.startsAt)
    .map((s) => {
      const l = ledgerOf.get(s.id);
      const holds = Object.values(l?.holds ?? {}).filter((until) => until > now).length;
      const room = roomOf.get(s.roomId);
      return {
        sessionId: s.id,
        title: s.title,
        room: room?.name ?? s.roomId,
        startsAt: s.startsAt,
        live: s.startsAt <= now,
        capacity: s.capacity,
        enrolled: s.enrolled,
        holds,
        free: freeSeats(s, l?.holds ?? {}, now),
        occupancy: room?.occupancy ?? null,
        occupancySource: room?.occupancySource ?? null,
        closed: l?.closed ?? false,
        cantHear: aggregateAv(signals, s.id, 'CANT_HEAR', now).distinct,
        cantSee: aggregateAv(signals, s.id, 'CANT_SEE', now).distinct,
        openAv: incidents.filter((i) => i.roomId === s.roomId && i.category === 'AV' && isOpen(i.status)).map((i) => ({ id: i.id, title: i.title })),
      };
    });
}

export type VenueBoardRow = Awaited<ReturnType<typeof venueBoard>>[number];

// --- export and erasure ---

/** The person's own companion records: plan, AV signals, questions they asked, seats they hold. */
export async function exportCompanion(ctx: ServiceContext, userId: string) {
  const ledgers = await ctx.store.docList('seatLedgers');
  return {
    plans: (await ctx.store.docList('plans', { userId })).map((p) => ({ eventId: p.eventId, sessionIds: p.sessionIds, stepFree: p.stepFree })),
    avSignals: (await ctx.store.docList('avSignals', { userId })).map((s) => ({ sessionId: s.sessionId, kind: s.kind, at: new Date(s.at).toISOString(), better: s.better })),
    questions: (await ctx.store.docList('liveQuestions', { authorId: userId })).map((q) => ({ sessionId: q.sessionId, text: q.text, at: new Date(q.createdAt).toISOString() })),
    seatHolds: ledgers.filter((l) => userId in l.holds).map((l) => ({ sessionId: l.sessionId, until: new Date(l.holds[userId] as number).toISOString() })),
  };
}

/** Deletes the person's plan, signals and questions, removes their votes and seat holds. Others' records stay. */
export async function eraseCompanion(ctx: ServiceContext, userId: string): Promise<number> {
  let n = 0;
  for (const p of await ctx.store.docList('plans', { userId })) if (await ctx.store.docDelete('plans', p.id)) n += 1;
  for (const s of await ctx.store.docList('avSignals', { userId })) if (await ctx.store.docDelete('avSignals', s.id)) n += 1;
  for (const q of await ctx.store.docList('liveQuestions')) {
    if (q.authorId === userId) {
      if (await ctx.store.docDelete('liveQuestions', q.id)) n += 1;
    } else if (q.votes.includes(userId)) {
      await ctx.store.docMutate('liveQuestions', q.id, (doc) => ({ ...doc, votes: doc.votes.filter((v) => v !== userId) }));
      n += 1;
    }
  }
  for (const l of await ctx.store.docList('seatLedgers')) {
    if (userId in l.holds) {
      await ctx.store.docMutate('seatLedgers', l.id, (doc) => ({ ...doc, holds: Object.fromEntries(Object.entries(doc.holds).filter(([uid]) => uid !== userId)) }));
      n += 1;
    }
  }
  return n;
}
