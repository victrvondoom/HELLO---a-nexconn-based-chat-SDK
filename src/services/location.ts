import { z } from 'zod';
import { DomainError } from '../domain/errors';
import type { LocationAudience, LocationShare } from '../domain/product';
import { COUNTRIES, countryName, isCountry, project } from '../lib/geo';
import { audit, requireCapability, type ServiceContext } from './context';
import { MIN_GROUP_SIZE } from '../domain/privacy';

/**
 * Live location, shared only by choice.
 *
 * - Nothing is shared until the person turns it on, picks who can see it, and picks how long.
 * - Every share expires on its own. There is no "forever".
 * - The server decides who sees a position on every read: the whole event, or mutual connections.
 * - Coordinates are sealed at rest and can be rounded to about a kilometre before they are stored.
 */

export const ShareSchema = z.object({
  audience: z.enum(['CONNECTIONS', 'EVENT']),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  approximate: z.boolean(),
  minutes: z.union([z.literal(15), z.literal(60), z.literal(240)]),
});

export const CountrySchema = z.object({ country: z.string().regex(/^\d{3}$/).nullable() });

const PositionSchema = z.object({ lat: z.number(), lng: z.number() });
const shareId = (eventId: string, userId: string) => `${eventId}:${userId}`;
const sealContext = (userId: string) => `location:${userId}`;

export async function shareLocation(ctx: ServiceContext, eventId: string, userId: string, input: z.infer<typeof ShareSchema>): Promise<{ expiresAt: number }> {
  await requireCapability(ctx, eventId, userId, 'event.read');
  const round = (n: number) => (input.approximate ? Math.round(n * 100) / 100 : Math.round(n * 1e5) / 1e5);
  const now = ctx.now();
  const existing = await ctx.store.docGet('locations', shareId(eventId, userId));
  // A position update keeps the original end time: sharing cannot be stretched by staying on the page.
  const sameShare = existing && existing.expiresAt > now && existing.audience === input.audience && existing.approximate === input.approximate;
  const share: LocationShare = {
    id: shareId(eventId, userId),
    eventId,
    userId,
    audience: input.audience,
    approximate: input.approximate,
    sealed: ctx.vault.seal(JSON.stringify({ lat: round(input.lat), lng: round(input.lng) }), sealContext(userId)),
    updatedAt: now,
    expiresAt: sameShare ? existing.expiresAt : now + input.minutes * 60_000,
  };
  await ctx.store.docPut('locations', share);
  if (!sameShare) {
    await audit(ctx, eventId, userId, 'location.share', 'user', userId, `Started sharing live location with ${input.audience === 'EVENT' ? 'the event' : 'connections'} for ${input.minutes} minutes.`);
  }
  return { expiresAt: share.expiresAt };
}

export async function stopSharing(ctx: ServiceContext, eventId: string, userId: string): Promise<void> {
  await requireCapability(ctx, eventId, userId, 'event.read');
  if (await ctx.store.docDelete('locations', shareId(eventId, userId))) {
    await audit(ctx, eventId, userId, 'location.stop', 'user', userId, 'Stopped sharing live location.');
  }
}

export async function setCountry(ctx: ServiceContext, userId: string, country: string | null): Promise<void> {
  if (country !== null && !isCountry(country)) throw new DomainError('VALIDATION_FAILED', 'Choose a country from the list.');
  // Merged, not replaced: prefs hold other choices too (the leaderboard opt-in).
  const existing = await ctx.store.docGet('prefs', userId);
  await ctx.store.docPut('prefs', { ...existing, id: userId, country });
}

export interface MapPerson {
  userId: string;
  name: string;
  isSelf: boolean;
  audience: LocationAudience;
  approximate: boolean;
  lat: number;
  lng: number;
  x: number;
  y: number;
  updatedAt: number;
  expiresAt: number;
}

export async function mapView(ctx: ServiceContext, eventId: string, userId: string) {
  await requireCapability(ctx, eventId, userId, 'event.read');
  const now = ctx.now();
  const [followers, following, memberships] = await Promise.all([ctx.store.listFollowers(userId), ctx.store.listFollowing(userId), ctx.store.listMemberships(eventId)]);
  const followsMe = new Set(followers.map((f) => f.followerId));
  const connections = new Set(following.map((f) => f.followeeId).filter((id) => followsMe.has(id)));

  const people: MapPerson[] = [];
  for (const share of await ctx.store.docList('locations', { eventId })) {
    if (share.expiresAt <= now) {
      await ctx.store.docDelete('locations', share.id);
      continue;
    }
    const isSelf = share.userId === userId;
    if (!isSelf && share.audience === 'CONNECTIONS' && !connections.has(share.userId)) continue;
    let position: z.infer<typeof PositionSchema>;
    try {
      position = PositionSchema.parse(JSON.parse(ctx.vault.open(share.sealed, sealContext(share.userId))));
    } catch {
      continue; // sealed under a key this process no longer has
    }
    const point = project(position.lat, position.lng);
    if (!point) continue;
    people.push({
      userId: share.userId,
      name: (await ctx.store.getUser(share.userId))?.displayName ?? 'Someone',
      isSelf,
      audience: share.audience,
      approximate: share.approximate,
      ...position,
      ...point,
      updatedAt: share.updatedAt,
      expiresAt: share.expiresAt,
    });
  }

  // Countries are shown as totals only: a count, never a list of who.
  const counts = new Map<string, number>();
  for (const m of memberships) {
    const country = (await ctx.store.docGet('prefs', m.userId))?.country;
    if (country) counts.set(country, (counts.get(country) ?? 0) + 1);
  }
  const myCountry = (await ctx.store.docGet('prefs', userId))?.country ?? null;
  // A count of one or two identifies people ("the one attendee from Iceland"), so those countries are not
  // shown. The response says how many were held back, so the map does not look emptier than it is.
  const shown = [...counts.entries()].filter(([, members]) => members >= MIN_GROUP_SIZE);
  return {
    now,
    me: people.find((p) => p.isSelf) ?? null,
    people,
    countries: shown.map(([code, members]) => ({ code, name: countryName(code) ?? code, members })).sort((a, b) => b.members - a.members),
    hiddenCountries: counts.size - shown.length,
    minGroupSize: MIN_GROUP_SIZE,
    myCountry,
    countryOptions: COUNTRIES,
  };
}
