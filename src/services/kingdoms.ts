import { z } from 'zod';
import { DomainError } from '../domain/errors';
import { roleHasCapability } from '../domain/permissions';
import type { Kingdom, KingdomChronicle, KingdomChronicleKind, KingdomCitizen, KingdomForge } from '../domain/product';
import { forgeFrom } from '../domain/kingdom/forge';
import {
  actFor,
  DECREE_MAX,
  HOME_NAME_MAX,
  homeTier,
  FORGE_PENDING_MAX,
  FORGE_PROMPT_MAX,
  INGEST_KINDS,
  MOTTO_MAX,
  MOVE_INTERVAL_MS,
  NAME_MAX,
  screenText,
  TITLE_MAX,
} from '../domain/kingdom/rules';
import { ROOF_COLOURS, canStep, gatePosition, homeFor, inBounds, isWalkable, MAX_CITIZENS, streetPlan, WORLD_SIZE, type Home, type Lot } from '../domain/kingdom/world';
import { audit, requireCapability, type ServiceContext } from './context';

/**
 * Kingdoms: one persistent shared world per event. The host (or whoever founds it) is the monarch; every
 * member who joins is a citizen with a home that never moves; what happens in the event is written to the
 * world's chronicle.
 *
 * Rules worth knowing:
 * - The monarch is `kingdom.ownerId`. Governing needs the monarch, or `content.moderate` staff. Hiding a
 *   button is never the boundary: every action below re-checks.
 * - A person is a citizen once (`${kingdomId}:${userId}`) and a lot is claimed through one atomic update of the
 *   kingdom, so two people joining at once can never be given the same home.
 * - The forge is deterministic (domain/kingdom/forge.ts). No model runs, and nothing it makes is visible in the
 *   world until the monarch approves it. A monarch's own wishes are approved at once.
 * - Outside events (follows, cheers, raids) enter through the `ingest` action, deduplicated by their own id.
 *   Nothing here talks to Twitch: a verified Twitch adapter would call this action, and does not exist yet.
 */

const CHRONICLE_PAGE = 40;
const FORGE_APPROVED_MAX = 200;
const EXTERNAL_ID = /^[A-Za-z0-9_-]{1,64}$/;

export const FoundSchema = z.object({ name: z.string().max(200), motto: z.string().max(400).default('') });

export const KingdomActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('join') }),
  z.object({ action: z.literal('leave') }),
  z.object({ action: z.literal('move'), x: z.number().int(), z: z.number().int() }),
  z.object({ action: z.literal('title'), title: z.string().max(200) }),
  z.object({ action: z.literal('home'), name: z.string().max(200), roof: z.enum(ROOF_COLOURS) }),
  z.object({ action: z.literal('decree'), text: z.string().max(1000) }),
  z.object({ action: z.literal('gates'), open: z.boolean() }),
  z.object({ action: z.literal('banish'), userId: z.string().min(1).max(80), reason: z.string().max(300).default('') }),
  z.object({ action: z.literal('pardon'), userId: z.string().min(1).max(80) }),
  z.object({ action: z.literal('forge'), prompt: z.string().max(500), x: z.number().int().optional(), z: z.number().int().optional() }),
  z.object({ action: z.literal('decide'), forgeId: z.string().min(1).max(80), approve: z.boolean(), note: z.string().max(300).default('') }),
  z.object({
    action: z.literal('ingest'),
    kind: z.enum(INGEST_KINDS),
    who: z.string().max(200),
    amount: z.number().int().min(1).max(1_000_000).default(1),
    externalId: z.string().max(100).optional(),
  }),
]);
export type KingdomAction = z.infer<typeof KingdomActionSchema>;

export interface CitizenView {
  userId: string;
  name: string;
  title: string;
  x: number;
  z: number;
  home: (Home & { name: string; tier: string; followers: number }) | null;
  banned: boolean;
  isMonarch: boolean;
  isYou: boolean;
}

export interface ForgeView {
  id: string;
  requester: { id: string; name: string };
  prompt: string;
  kit: string;
  colour: string;
  status: KingdomForge['status'];
  decisionNote: string;
  x: number;
  z: number;
  mine: boolean;
}

export interface ChronicleView {
  id: string;
  kind: KingdomChronicleKind;
  text: string;
  at: number;
  x: number | null;
  z: number | null;
}

export interface KingdomView {
  now: number;
  /** Null until someone founds it. */
  kingdom: { id: string; name: string; motto: string; seed: number; openGates: boolean; citizenCount: number; capacity: number; size: number; monarchName: string } | null;
  you: { citizen: CitizenView | null; isMonarch: boolean; canGovern: boolean; canFound: boolean; canJoin: boolean };
  citizens: CitizenView[];
  /** Approved things in the world, plus (for those who govern, or their own) the ones waiting. */
  forges: ForgeView[];
  chronicle: ChronicleView[];
  lots: Lot[];
  gate: { x: number; z: number };
}

function homeView(seed: number, c: KingdomCitizen, followers: number): CitizenView['home'] {
  const base = homeFor(seed, c.lot);
  if (!base) return null;
  const tier = homeTier(followers);
  return { ...base, roof: c.roof ?? base.roof, storeys: tier.storeys, name: c.homeName ?? `${c.name}'s ${tier.label.toLowerCase()}`, tier: tier.label, followers };
}

const kingdomId = (eventId: string) => `kingdom-${eventId}`;
const citizenId = (kingdomIdValue: string, userId: string) => `${kingdomIdValue}:${userId}`;

/** A seed that is the same for the same event, so a re-founded kingdom (after deletion) grows back alike. */
function seedFor(eventId: string): number {
  let h = 2166136261;
  for (let i = 0; i < eventId.length; i += 1) h = Math.imul(h ^ eventId.charCodeAt(i), 16777619);
  return h >>> 0;
}

async function loadKingdom(ctx: ServiceContext, eventId: string): Promise<Kingdom | null> {
  const k = await ctx.store.docGet('kingdoms', kingdomId(eventId));
  return k && k.eventId === eventId ? k : null;
}

async function mustKingdom(ctx: ServiceContext, eventId: string): Promise<Kingdom> {
  const k = await loadKingdom(ctx, eventId);
  if (!k) throw new DomainError('NOT_FOUND', 'This event has no kingdom yet.');
  return k;
}

async function governs(ctx: ServiceContext, kingdom: Kingdom, userId: string): Promise<boolean> {
  if (kingdom.ownerId === userId) return true;
  const membership = await ctx.store.findMembership(kingdom.eventId, userId);
  return !!membership && roleHasCapability(membership.role, 'content.moderate');
}

async function nameOf(ctx: ServiceContext, userId: string): Promise<string> {
  return (await ctx.store.getUser(userId))?.displayName ?? 'A traveller';
}

async function chronicle(
  ctx: ServiceContext,
  kingdom: Kingdom,
  kind: KingdomChronicleKind,
  actorId: string | null,
  text: string,
  at: { x: number; z: number } | null = null,
  id?: string,
): Promise<boolean> {
  const entry: KingdomChronicle = {
    id: id ?? ctx.newId('kc'),
    kingdomId: kingdom.id,
    eventId: kingdom.eventId,
    kind,
    actorId,
    text,
    at: ctx.now(),
    x: at?.x ?? null,
    z: at?.z ?? null,
  };
  return ctx.store.docPutIfAbsent('kingdomChronicle', entry);
}

function check(result: ReturnType<typeof screenText>): string {
  if (!result.ok) throw new DomainError('VALIDATION_FAILED', result.reason);
  return result.text;
}

export async function kingdomView(ctx: ServiceContext, eventId: string, userId: string): Promise<KingdomView> {
  const membership = await requireCapability(ctx, eventId, userId, 'event.read');
  const kingdom = await loadKingdom(ctx, eventId);
  const now = ctx.now();
  const gate = gatePosition();
  if (!kingdom) {
    return {
      now,
      kingdom: null,
      you: { citizen: null, isMonarch: false, canGovern: false, canFound: roleHasCapability(membership.role, 'message.send'), canJoin: false },
      citizens: [],
      forges: [],
      chronicle: [],
      lots: [],
      gate,
    };
  }
  const canGovern = await governs(ctx, kingdom, userId);
  const [citizenDocs, forgeDocs, chronicleDocs] = await Promise.all([
    ctx.store.docList('kingdomCitizens', { kingdomId: kingdom.id }),
    ctx.store.docList('kingdomForges', { kingdomId: kingdom.id }),
    ctx.store.docList('kingdomChronicle', { kingdomId: kingdom.id }),
  ]);
  const followerCounts = new Map<string, number>(
    await Promise.all(citizenDocs.map(async (c) => [c.userId, (await ctx.store.listFollowers(c.userId)).length] as const)),
  );
  const citizens: CitizenView[] = citizenDocs
    // A banished person is not shown walking the world; the monarch still sees them, to be able to pardon.
    .filter((c) => !c.banned || canGovern || c.userId === userId)
    .map((c) => ({
      userId: c.userId,
      name: c.name,
      title: c.title,
      x: c.x,
      z: c.z,
      home: homeView(kingdom.seed, c, followerCounts.get(c.userId) ?? 0),
      banned: c.banned,
      isMonarch: c.userId === kingdom.ownerId,
      isYou: c.userId === userId,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const me = citizens.find((c) => c.isYou) ?? null;
  const forges: ForgeView[] = forgeDocs
    .filter((f) => f.status === 'APPROVED' || canGovern || f.requesterId === userId)
    .sort((a, b) => a.createdAt - b.createdAt)
    .map((f) => ({
      id: f.id,
      requester: { id: f.requesterId, name: citizenDocs.find((c) => c.userId === f.requesterId)?.name ?? 'A former citizen' },
      prompt: f.prompt,
      kit: f.kit,
      colour: f.colour,
      status: f.status,
      decisionNote: f.decisionNote,
      x: f.x,
      z: f.z,
      mine: f.requesterId === userId,
    }));
  const recent = chronicleDocs.sort((a, b) => b.at - a.at || (a.id < b.id ? 1 : -1)).slice(0, CHRONICLE_PAGE);
  return {
    now,
    kingdom: {
      id: kingdom.id,
      name: kingdom.name,
      motto: kingdom.motto,
      seed: kingdom.seed,
      openGates: kingdom.openGates,
      citizenCount: citizenDocs.filter((c) => !c.banned).length,
      capacity: Math.min(MAX_CITIZENS, streetPlan(kingdom.seed).length),
      size: WORLD_SIZE,
      monarchName: citizenDocs.find((c) => c.userId === kingdom.ownerId)?.name ?? (await nameOf(ctx, kingdom.ownerId)),
    },
    you: {
      citizen: me,
      isMonarch: kingdom.ownerId === userId,
      canGovern,
      canFound: false,
      canJoin: !me && kingdom.openGates && roleHasCapability(membership.role, 'message.send'),
    },
    citizens,
    forges,
    chronicle: recent.map((c) => ({ id: c.id, kind: c.kind, text: c.text, at: c.at, x: c.x, z: c.z })),
    lots: streetPlan(kingdom.seed),
    gate,
  };
}

/** Founds the event's kingdom. One per event: a second founder gets DUPLICATE, so two people cannot both win. */
export async function foundKingdom(ctx: ServiceContext, eventId: string, userId: string, input: z.infer<typeof FoundSchema>): Promise<Kingdom> {
  await requireCapability(ctx, eventId, userId, 'message.send');
  const name = check(screenText(input.name, NAME_MAX, 'The kingdom name'));
  const motto = input.motto.trim() ? check(screenText(input.motto, MOTTO_MAX, 'The motto')) : '';
  const kingdom: Kingdom = {
    id: kingdomId(eventId),
    eventId,
    ownerId: userId,
    name,
    motto,
    seed: seedFor(eventId),
    openGates: true,
    nextLot: 0,
    freeLots: [],
    version: 1,
    createdAt: ctx.now(),
  };
  if (!(await ctx.store.docPutIfAbsent('kingdoms', kingdom))) throw new DomainError('DUPLICATE', 'This event already has a kingdom.');
  await chronicle(ctx, kingdom, 'FOUNDED', userId, `${name} was founded.`, gatePosition());
  await audit(ctx, eventId, userId, 'kingdom.found', 'kingdom', kingdom.id, `Founded the kingdom "${name}".`);
  await admit(ctx, kingdom, userId);
  return kingdom;
}

/** Claims a lot atomically, then writes the citizen. Throws INELIGIBLE when the kingdom is full. */
async function admit(ctx: ServiceContext, kingdom: Kingdom, userId: string): Promise<KingdomCitizen> {
  const existing = await ctx.store.docGet('kingdomCitizens', citizenId(kingdom.id, userId));
  if (existing) return existing;
  const capacity = Math.min(MAX_CITIZENS, streetPlan(kingdom.seed).length);
  // The update function may run more than once (the store retries on conflict), so each run starts clean.
  const claim: { lot: number | null } = { lot: null };
  await ctx.store.docMutate('kingdoms', kingdom.id, (k) => {
    claim.lot = null;
    const [first, ...rest] = [...k.freeLots].sort((a, b) => a - b);
    if (first !== undefined) {
      claim.lot = first;
      return { ...k, freeLots: rest, version: k.version + 1 };
    }
    if (k.nextLot >= capacity) return null;
    claim.lot = k.nextLot;
    return { ...k, nextLot: k.nextLot + 1, version: k.version + 1 };
  });
  const claimed = claim.lot;
  if (claimed === null) throw new DomainError('INELIGIBLE', 'The kingdom is full: every lot has a home.');
  const gate = gatePosition();
  const citizen: KingdomCitizen = {
    id: citizenId(kingdom.id, userId),
    kingdomId: kingdom.id,
    eventId: kingdom.eventId,
    userId,
    name: await nameOf(ctx, userId),
    title: userId === kingdom.ownerId ? 'Monarch' : 'Citizen',
    lot: claimed,
    x: gate.x,
    z: gate.z,
    joinedAt: ctx.now(),
    movedAt: 0,
    banned: false,
  };
  if (!(await ctx.store.docPutIfAbsent('kingdomCitizens', citizen))) {
    // The same person joined twice at once. Give the lot back and use the first record.
    await ctx.store.docMutate('kingdoms', kingdom.id, (k) => ({ ...k, freeLots: [...k.freeLots, claimed] }));
    const first = await ctx.store.docGet('kingdomCitizens', citizen.id);
    if (!first) throw new DomainError('NOT_FOUND', 'Your citizenship could not be read. Try again.');
    return first;
  }
  await chronicle(ctx, kingdom, 'CITIZEN_JOINED', userId, `${citizen.name} became a citizen and took a home.`, gate);
  return citizen;
}

async function mustCitizen(ctx: ServiceContext, kingdom: Kingdom, userId: string): Promise<KingdomCitizen> {
  const c = await ctx.store.docGet('kingdomCitizens', citizenId(kingdom.id, userId));
  if (!c) throw new DomainError('FORBIDDEN', 'You are not a citizen of this kingdom.');
  return c;
}

export async function kingdomAction(ctx: ServiceContext, eventId: string, userId: string, input: KingdomAction): Promise<{ ok: true; duplicate?: boolean; forgeId?: string }> {
  await requireCapability(ctx, eventId, userId, 'message.send');
  const kingdom = await mustKingdom(ctx, eventId);
  switch (input.action) {
    case 'join': {
      if (!kingdom.openGates && kingdom.ownerId !== userId) throw new DomainError('INELIGIBLE', 'The gates are closed to newcomers.');
      const prior = await ctx.store.docGet('kingdomCitizens', citizenId(kingdom.id, userId));
      if (prior?.banned) throw new DomainError('FORBIDDEN', 'You have been banished from this kingdom.');
      await admit(ctx, kingdom, userId);
      return { ok: true };
    }
    case 'leave': {
      const c = await mustCitizen(ctx, kingdom, userId);
      if (kingdom.ownerId === userId) throw new DomainError('INELIGIBLE', 'The monarch cannot leave their own kingdom.');
      // A banished citizen keeps their record, so banishment cannot be undone by leaving and rejoining.
      if (c.banned) throw new DomainError('FORBIDDEN', 'You have been banished from this kingdom.');
      await ctx.store.docDelete('kingdomCitizens', c.id);
      await ctx.store.docMutate('kingdoms', kingdom.id, (k) => ({ ...k, freeLots: [...new Set([...k.freeLots, c.lot])], version: k.version + 1 }));
      for (const f of await ctx.store.docList('kingdomForges', { kingdomId: kingdom.id, requesterId: userId, status: 'PENDING' })) await ctx.store.docDelete('kingdomForges', f.id);
      await chronicle(ctx, kingdom, 'CITIZEN_LEFT', userId, `${c.name} left the kingdom and gave up their home.`);
      return { ok: true };
    }
    case 'move': {
      const c = await mustCitizen(ctx, kingdom, userId);
      if (c.banned) throw new DomainError('FORBIDDEN', 'You have been banished from this kingdom.');
      if (!inBounds(input.x, input.z) || !canStep(kingdom.seed, c, input)) throw new DomainError('VALIDATION_FAILED', 'You cannot walk there.');
      const now = ctx.now();
      if (c.movedAt && now - c.movedAt < MOVE_INTERVAL_MS) throw new DomainError('RATE_LIMITED', 'Walking too fast. Wait a moment.', { retryAfterSeconds: 1 });
      await ctx.store.docMutate('kingdomCitizens', c.id, (x) => (x.banned ? null : { ...x, x: input.x, z: input.z, movedAt: now }));
      return { ok: true };
    }
    case 'title': {
      const c = await mustCitizen(ctx, kingdom, userId);
      if (c.banned) throw new DomainError('FORBIDDEN', 'You have been banished from this kingdom.');
      if (kingdom.ownerId === userId) throw new DomainError('INELIGIBLE', 'The monarch keeps the title of Monarch.');
      const title = check(screenText(input.title, TITLE_MAX, 'Your title'));
      await ctx.store.docMutate('kingdomCitizens', c.id, (x) => ({ ...x, title }));
      return { ok: true };
    }
    case 'home': {
      const c = await mustCitizen(ctx, kingdom, userId);
      if (c.banned) throw new DomainError('FORBIDDEN', 'You have been banished from this kingdom.');
      const homeName = check(screenText(input.name, HOME_NAME_MAX, 'The home name'));
      await ctx.store.docMutate('kingdomCitizens', c.id, (x) => (x.banned ? null : { ...x, homeName, roof: input.roof }));
      return { ok: true };
    }
    case 'decree': {
      if (!(await governs(ctx, kingdom, userId))) throw new DomainError('FORBIDDEN', 'Only the monarch can issue decrees.');
      const text = check(screenText(input.text, DECREE_MAX, 'The decree'));
      await chronicle(ctx, kingdom, 'DECREE', userId, text);
      await audit(ctx, eventId, userId, 'kingdom.decree', 'kingdom', kingdom.id, 'Issued a decree.');
      return { ok: true };
    }
    case 'gates': {
      if (!(await governs(ctx, kingdom, userId))) throw new DomainError('FORBIDDEN', 'Only the monarch can open or close the gates.');
      await ctx.store.docMutate('kingdoms', kingdom.id, (k) => ({ ...k, openGates: input.open, version: k.version + 1 }));
      await audit(ctx, eventId, userId, 'kingdom.gates', 'kingdom', kingdom.id, input.open ? 'Opened the gates.' : 'Closed the gates.');
      return { ok: true };
    }
    case 'banish':
    case 'pardon': {
      if (!(await governs(ctx, kingdom, userId))) throw new DomainError('FORBIDDEN', 'Only the monarch can banish or pardon.');
      if (input.userId === kingdom.ownerId) throw new DomainError('INELIGIBLE', 'The monarch cannot be banished.');
      const target = await ctx.store.docGet('kingdomCitizens', citizenId(kingdom.id, input.userId));
      if (!target) throw new DomainError('NOT_FOUND', 'That person is not a citizen.');
      const banned = input.action === 'banish';
      const reason = banned && input.reason.trim() ? check(screenText(input.reason, 300, 'The reason')) : '';
      await ctx.store.docMutate('kingdomCitizens', target.id, (x) => ({ ...x, banned }));
      if (banned) {
        for (const f of await ctx.store.docList('kingdomForges', { kingdomId: kingdom.id, requesterId: input.userId, status: 'PENDING' })) await ctx.store.docDelete('kingdomForges', f.id);
      }
      await chronicle(ctx, kingdom, banned ? 'BANISHED' : 'PARDONED', userId, banned ? `${target.name} was banished.` : `${target.name} was pardoned.`);
      await audit(ctx, eventId, userId, banned ? 'kingdom.banish' : 'kingdom.pardon', 'user', input.userId, banned ? `Banished a citizen.${reason ? ` Reason: ${reason}` : ''}` : 'Pardoned a citizen.');
      return { ok: true };
    }
    case 'forge': {
      const c = await mustCitizen(ctx, kingdom, userId);
      if (c.banned) throw new DomainError('FORBIDDEN', 'You have been banished from this kingdom.');
      const prompt = check(screenText(input.prompt, FORGE_PROMPT_MAX, 'Your wish'));
      const result = forgeFrom(prompt);
      if (!result) throw new DomainError('VALIDATION_FAILED', 'The Forge only knows trees, lanterns, fountains, statues, banners, benches, gardens, towers, markets and campfires. Name one.');
      const x = input.x ?? c.x;
      const z = input.z ?? c.z;
      if (!isWalkable(kingdom.seed, x, z)) throw new DomainError('VALIDATION_FAILED', 'Things can only be placed on dry, open ground.');
      const all = await ctx.store.docList('kingdomForges', { kingdomId: kingdom.id });
      if (all.filter((f) => f.requesterId === userId && f.status === 'PENDING').length >= FORGE_PENDING_MAX) {
        throw new DomainError('RATE_LIMITED', `You already have ${FORGE_PENDING_MAX} wishes waiting for the monarch.`, { retryAfterSeconds: 60 });
      }
      if (all.filter((f) => f.status === 'APPROVED').length >= FORGE_APPROVED_MAX) throw new DomainError('INELIGIBLE', 'The kingdom has no room for more things.');
      const monarch = kingdom.ownerId === userId;
      const forge: KingdomForge = {
        id: ctx.newId('kf'),
        kingdomId: kingdom.id,
        eventId,
        requesterId: userId,
        prompt,
        kit: result.kit,
        colour: result.colour,
        status: monarch ? 'APPROVED' : 'PENDING',
        decidedBy: monarch ? userId : null,
        decisionNote: '',
        x,
        z,
        createdAt: ctx.now(),
        decidedAt: monarch ? ctx.now() : null,
      };
      await ctx.store.docPut('kingdomForges', forge);
      if (monarch) await chronicle(ctx, kingdom, 'FORGED', userId, `${c.name} forged a ${result.kit.toLowerCase()}.`, { x, z });
      return { ok: true, forgeId: forge.id };
    }
    case 'decide': {
      if (!(await governs(ctx, kingdom, userId))) throw new DomainError('FORBIDDEN', 'Only the monarch can approve or refuse forged things.');
      const note = input.note.trim() ? check(screenText(input.note, 300, 'The note')) : '';
      const decided = await ctx.store.docMutate('kingdomForges', input.forgeId, (f) => {
        if (f.kingdomId !== kingdom.id || f.status !== 'PENDING') return null;
        return { ...f, status: input.approve ? 'APPROVED' : 'REJECTED', decidedBy: userId, decisionNote: note, decidedAt: ctx.now() };
      });
      if (!decided || decided.decidedBy !== userId || decided.status === 'PENDING') throw new DomainError('ALREADY_HANDLED', 'That wish is not waiting for a decision.');
      if (decided.status === 'APPROVED') {
        const who = (await ctx.store.docGet('kingdomCitizens', citizenId(kingdom.id, decided.requesterId)))?.name ?? 'A citizen';
        await chronicle(ctx, kingdom, 'FORGED', decided.requesterId, `${who} forged a ${decided.kit.toLowerCase()}.`, { x: decided.x, z: decided.z });
      }
      await audit(ctx, eventId, userId, input.approve ? 'kingdom.forge.approve' : 'kingdom.forge.reject', 'kingdomForge', decided.id, `${input.approve ? 'Approved' : 'Refused'} a forged ${decided.kit.toLowerCase()}.`);
      return { ok: true };
    }
    case 'ingest': {
      if (!(await governs(ctx, kingdom, userId))) throw new DomainError('FORBIDDEN', 'Only the monarch can tell the kingdom what happened outside it.');
      if (input.externalId !== undefined && !EXTERNAL_ID.test(input.externalId)) throw new DomainError('VALIDATION_FAILED', 'The event id may only use letters, digits, dash and underscore.');
      const who = check(screenText(input.who, NAME_MAX, 'The name'));
      const act = actFor(input.kind, who, input.amount);
      const id = input.externalId ? `kc-ext-${kingdom.id}-${input.externalId}` : undefined;
      const fresh = await chronicle(ctx, kingdom, act.kind, null, act.text, gatePosition(), id);
      if (fresh) await audit(ctx, eventId, userId, 'kingdom.ingest', 'kingdom', kingdom.id, `Recorded a ${input.kind.toLowerCase()} from outside the kingdom.`);
      // A repeated delivery of the same outside event is a no-op, as a webhook retry would be.
      return fresh ? { ok: true } : { ok: true, duplicate: true };
    }
  }
}

/** Removes a person from every kingdom of the given events (erasure). Their kingdom, if they founded one, goes with its contents. */
export async function eraseKingdoms(ctx: ServiceContext, userId: string, eventIds: string[]): Promise<number> {
  let removed = 0;
  for (const eventId of eventIds) {
    const kingdom = await loadKingdom(ctx, eventId);
    if (!kingdom) continue;
    if (kingdom.ownerId === userId) {
      for (const c of await ctx.store.docList('kingdomCitizens', { kingdomId: kingdom.id })) {
        await ctx.store.docDelete('kingdomCitizens', c.id);
        removed += 1;
      }
      for (const f of await ctx.store.docList('kingdomForges', { kingdomId: kingdom.id })) {
        await ctx.store.docDelete('kingdomForges', f.id);
        removed += 1;
      }
      for (const e of await ctx.store.docList('kingdomChronicle', { kingdomId: kingdom.id })) {
        await ctx.store.docDelete('kingdomChronicle', e.id);
        removed += 1;
      }
      await ctx.store.docDelete('kingdoms', kingdom.id);
      removed += 1;
      continue;
    }
    const mine = await ctx.store.docGet('kingdomCitizens', citizenId(kingdom.id, userId));
    if (mine) {
      await ctx.store.docDelete('kingdomCitizens', mine.id);
      await ctx.store.docMutate('kingdoms', kingdom.id, (k) => ({ ...k, freeLots: [...new Set([...k.freeLots, mine.lot])] }));
      removed += 1;
    }
    for (const f of await ctx.store.docList('kingdomForges', { kingdomId: kingdom.id, requesterId: userId })) {
      await ctx.store.docDelete('kingdomForges', f.id);
      removed += 1;
    }
    for (const e of await ctx.store.docList('kingdomChronicle', { kingdomId: kingdom.id, actorId: userId })) {
      await ctx.store.docMutate('kingdomChronicle', e.id, (x) => ({ ...x, actorId: null, text: 'A citizen who has since left did this.' }));
      removed += 1;
    }
  }
  return removed;
}

/** What the kingdom holds about one person, for their data export. */
export async function exportKingdomData(ctx: ServiceContext, userId: string, eventId: string) {
  const kingdom = await loadKingdom(ctx, eventId);
  if (!kingdom) return null;
  const citizen = await ctx.store.docGet('kingdomCitizens', citizenId(kingdom.id, userId));
  const forges = await ctx.store.docList('kingdomForges', { kingdomId: kingdom.id, requesterId: userId });
  return {
    kingdom: kingdom.name,
    isMonarch: kingdom.ownerId === userId,
    citizen: citizen ? { name: citizen.name, title: citizen.title, lot: citizen.lot, joinedAt: new Date(citizen.joinedAt).toISOString(), banned: citizen.banned } : null,
    forges: forges.map((f) => ({ wish: f.prompt, status: f.status, at: new Date(f.createdAt).toISOString() })),
  };
}
