import { z } from 'zod';
import { DomainError } from '../domain/errors';
import type { CustomMap } from '../domain/product';
import { requireCapability, type ServiceContext } from './context';

/**
 * Custom maps: a person's own map for an event (a family meeting point, a stall layout, a route through a fair),
 * made from a picture, a frame of a video or a sketch, with labelled pins. The picture is an uploaded media record
 * of this event; this service owns the map record. Only the owner can change or delete a map. A map is private to
 * its owner until they share it, and then every member of the event can see it.
 */

export const MAX_MAPS_PER_PERSON = 20;
export const MAX_PINS = 60;

const Pin = z.object({
  id: z.string().regex(/^[a-z0-9-]{1,40}$/),
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  label: z.string().trim().min(1).max(60),
  kind: z.enum(['PLACE', 'EXIT', 'MEET', 'HELP']),
});

export const CustomMapCreate = z.object({
  name: z.string().trim().min(1).max(80),
  mediaId: z.string().min(1).max(80),
  source: z.enum(['IMAGE', 'VIDEO_FRAME', 'SKETCH']),
});

export const CustomMapPatch = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  shared: z.boolean().optional(),
  pins: z.array(Pin).max(MAX_PINS).optional(),
});

/** The viewer's own maps and the maps others shared with the event, newest first. */
export async function listCustomMaps(ctx: ServiceContext, eventId: string, userId: string): Promise<{ mine: CustomMap[]; shared: CustomMap[] }> {
  await requireCapability(ctx, eventId, userId, 'event.read');
  const all = await ctx.store.docList('customMaps', { eventId });
  const newest = (a: CustomMap, b: CustomMap) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id);
  return {
    mine: all.filter((m) => m.ownerId === userId).sort(newest),
    shared: all.filter((m) => m.ownerId !== userId && m.shared).sort(newest),
  };
}

export async function createCustomMap(ctx: ServiceContext, eventId: string, userId: string, input: z.infer<typeof CustomMapCreate>): Promise<CustomMap> {
  await requireCapability(ctx, eventId, userId, 'message.send');
  const media = await ctx.store.docGet('media', input.mediaId);
  // The picture must be one this person uploaded to this event, and a picture rather than a video.
  if (!media || media.eventId !== eventId || media.ownerId !== userId || media.kind !== 'IMAGE') {
    throw new DomainError('VALIDATION_FAILED', 'Upload the map picture first, then save the map.');
  }
  const owned = await ctx.store.docList('customMaps', { eventId, ownerId: userId });
  if (owned.length >= MAX_MAPS_PER_PERSON) throw new DomainError('VALIDATION_FAILED', `You can keep up to ${MAX_MAPS_PER_PERSON} maps per event. Delete one first.`);
  const now = ctx.now();
  const map: CustomMap = { id: ctx.newId('cmap'), eventId, ownerId: userId, name: input.name, mediaId: media.id, source: input.source, shared: false, pins: [], createdAt: now, updatedAt: now };
  await ctx.store.docPut('customMaps', map);
  return map;
}

async function ownMap(ctx: ServiceContext, eventId: string, userId: string, mapId: string): Promise<CustomMap> {
  await requireCapability(ctx, eventId, userId, 'message.send');
  const map = await ctx.store.docGet('customMaps', mapId);
  // Someone else's map reads as missing, so its existence is not confirmed to people who cannot change it.
  if (!map || map.eventId !== eventId || map.ownerId !== userId) throw new DomainError('NOT_FOUND', 'That map does not exist.');
  return map;
}

export async function updateCustomMap(ctx: ServiceContext, eventId: string, userId: string, mapId: string, patch: z.infer<typeof CustomMapPatch>): Promise<CustomMap> {
  await ownMap(ctx, eventId, userId, mapId);
  const saved = await ctx.store.docMutate('customMaps', mapId, (map) => ({
    ...map,
    name: patch.name ?? map.name,
    shared: patch.shared ?? map.shared,
    pins: patch.pins ?? map.pins,
    updatedAt: ctx.now(),
  }));
  if (!saved) throw new DomainError('NOT_FOUND', 'That map does not exist.');
  return saved;
}

export async function deleteCustomMap(ctx: ServiceContext, eventId: string, userId: string, mapId: string): Promise<void> {
  await ownMap(ctx, eventId, userId, mapId);
  await ctx.store.docDelete('customMaps', mapId);
}

/** For the data export: the person's own maps. */
export async function exportCustomMaps(ctx: ServiceContext, userId: string) {
  const maps = await ctx.store.docList('customMaps', { ownerId: userId });
  return maps.map((m) => ({ name: m.name, eventId: m.eventId, source: m.source, shared: m.shared, pins: m.pins, createdAt: new Date(m.createdAt).toISOString() }));
}

/** For erasure: removes every map the person made, in every event. Returns the number removed. */
export async function eraseCustomMaps(ctx: ServiceContext, userId: string): Promise<number> {
  let removed = 0;
  for (const map of await ctx.store.docList('customMaps', { ownerId: userId })) {
    if (await ctx.store.docDelete('customMaps', map.id)) removed += 1;
  }
  return removed;
}
