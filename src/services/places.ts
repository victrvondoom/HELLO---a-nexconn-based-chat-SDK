import { DomainError } from '../domain/errors';
import type { PlaceCategory, PlaceCollection, PlaceImport, PlaceSource, PlaceStatus, PlaceVisit, SavedPlace } from '../domain/product';
import {
  MAX_COLLECTIONS_PER_OWNER,
  MAX_PLACES_PER_OWNER,
  MAX_PLACE_ADDRESS,
  MAX_PLACE_DESCRIPTION,
  PLACE_CATEGORY_VALUES,
  PLACE_STATUS_VALUES,
  cleanCollectionName,
  cleanCoordinates,
  cleanNote,
  cleanOptionalText,
  cleanPlaceName,
  cleanRating,
  cleanTags,
  filterPlaces,
  noteContext,
} from '../domain/places/rules';
import { requireCapability, type ServiceContext } from './context';
import { VersionConflictError } from '../store/store';

/**
 * Personal place memory. Every function here acts for one person, and every read or write is limited to that
 * person's own records within the event. Another person's place is reported as not found, which does not reveal
 * that it exists.
 */

export type PlaceView = Omit<SavedPlace, 'privateNoteSealed'> & { privateNote: string };

export interface PlaceInput {
  /** Set by capture code only. Route bodies cannot carry it, because their schema does not include it. */
  source?: { type: PlaceSource; reference: string | null };
  name: string;
  description?: string | null;
  category: PlaceCategory;
  spaceId?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  address?: string | null;
  status?: PlaceStatus;
  favourite?: boolean;
  rating?: number | null;
  privateNote?: string | null;
  collectionIds?: string[];
  tags?: string[];
}

export type PlacePatch = Partial<PlaceInput>;

export interface PlaceListing {
  places: PlaceView[];
  collections: PlaceCollection[];
  /** The person's own check-ins, newest first. */
  visits: PlaceVisit[];
  /** The person's own imports, newest first, with the rows that could not be read. */
  imports: PlaceImport[];
  /** The venue's spaces, so a place can be pinned to one. Empty when the event has no venue map. */
  spaces: Array<{ id: string; name: string; floor: number; outline: Array<readonly [number, number]> }>;
  limits: { places: number; collections: number };
}

const seal = (ctx: ServiceContext, ownerId: string, placeId: string, note: string): string => ctx.vault.seal(note, noteContext(ownerId, placeId));

function view(ctx: ServiceContext, place: SavedPlace): PlaceView {
  const { privateNoteSealed, ...rest } = place;
  return { ...rest, privateNote: ctx.vault.open(privateNoteSealed, noteContext(place.ownerId, place.id)) };
}

async function ownPlace(ctx: ServiceContext, eventId: string, ownerId: string, placeId: string): Promise<SavedPlace> {
  const place = await ctx.store.docGet('places', placeId);
  if (!place || place.eventId !== eventId || place.ownerId !== ownerId) {
    throw new DomainError('NOT_FOUND', 'Place not found.');
  }
  return place;
}

async function validateTargets(ctx: ServiceContext, eventId: string, ownerId: string, spaceId: string | null, collectionIds: readonly string[]): Promise<void> {
  if (spaceId !== null) {
    const venue = await ctx.store.getVenue(eventId);
    if (!venue?.spaces.some((space) => space.id === spaceId)) {
      throw new DomainError('VALIDATION_FAILED', 'That place is not on this event’s venue map.');
    }
  }
  if (collectionIds.length > 0) {
    const mine = new Set((await ctx.store.docList('placeCollections', { eventId, ownerId })).map((collection) => collection.id));
    if (collectionIds.some((id) => !mine.has(id))) throw new DomainError('VALIDATION_FAILED', 'Choose collections from your own list.');
  }
}

export async function listMyPlaces(ctx: ServiceContext, eventId: string, userId: string): Promise<PlaceListing> {
  await requireCapability(ctx, eventId, userId, 'event.read');
  const [places, collections, visits, imports, venue] = await Promise.all([
    ctx.store.docList('places', { eventId, ownerId: userId }),
    ctx.store.docList('placeCollections', { eventId, ownerId: userId }),
    ctx.store.docList('placeVisits', { eventId, ownerId: userId }),
    ctx.store.docList('placeImports', { eventId, ownerId: userId }),
    ctx.store.getVenue(eventId),
  ]);
  return {
    places: filterPlaces(places, {}).map((place) => view(ctx, place)),
    collections: collections.sort((a, b) => a.createdAt - b.createdAt),
    visits: visits.sort((a, b) => b.arrivedAt - a.arrivedAt),
    imports: imports.sort((a, b) => b.createdAt - a.createdAt),
    spaces: (venue?.spaces ?? []).map((space) => ({ id: space.id, name: space.name, floor: space.floor, outline: space.outline })),
    limits: { places: MAX_PLACES_PER_OWNER, collections: MAX_COLLECTIONS_PER_OWNER },
  };
}

export async function createPlace(ctx: ServiceContext, eventId: string, userId: string, input: PlaceInput): Promise<PlaceView> {
  await requireCapability(ctx, eventId, userId, 'event.read');
  const name = cleanPlaceName(input.name);
  const description = cleanOptionalText(input.description, MAX_PLACE_DESCRIPTION, 'Description') ?? '';
  const address = cleanOptionalText(input.address, MAX_PLACE_ADDRESS, 'Address');
  const { latitude, longitude } = cleanCoordinates(input.latitude ?? null, input.longitude ?? null);
  const rating = cleanRating(input.rating ?? null);
  const note = cleanNote(input.privateNote);
  const tags = cleanTags(input.tags ?? []);
  const collectionIds = [...new Set(input.collectionIds ?? [])];
  const spaceId = input.spaceId ?? null;
  if (!(PLACE_CATEGORY_VALUES as readonly string[]).includes(input.category)) throw new DomainError('VALIDATION_FAILED', 'Choose a category from the list.');
  if (input.status !== undefined && !(PLACE_STATUS_VALUES as readonly string[]).includes(input.status)) {
    throw new DomainError('VALIDATION_FAILED', 'Choose a status from the list.');
  }
  await validateTargets(ctx, eventId, userId, spaceId, collectionIds);

  const existing = await ctx.store.docList('places', { eventId, ownerId: userId });
  if (existing.length >= MAX_PLACES_PER_OWNER) {
    throw new DomainError('VALIDATION_FAILED', `You can keep up to ${MAX_PLACES_PER_OWNER} places for this event.`);
  }

  const now = ctx.now();
  const id = ctx.newId('plc');
  const place: SavedPlace = {
    id,
    eventId,
    ownerId: userId,
    name,
    description,
    category: input.category,
    spaceId,
    latitude,
    longitude,
    address,
    status: input.status ?? 'SAVED',
    favourite: input.favourite ?? false,
    rating,
    privateNoteSealed: seal(ctx, userId, id, note),
    collectionIds,
    tags,
    source: input.source ?? { type: spaceId ? 'VENUE_MAP' : 'MANUAL', reference: spaceId },
    visibility: 'PRIVATE',
    createdAt: now,
    updatedAt: now,
    updates: 0,
    version: 1,
  };
  await ctx.store.docPut('places', place);
  return view(ctx, place);
}

export async function updatePlace(
  ctx: ServiceContext,
  input: { eventId: string; userId: string; placeId: string; expectedVersion: number; patch: PlacePatch },
): Promise<PlaceView> {
  await requireCapability(ctx, input.eventId, input.userId, 'event.read');
  const current = await ownPlace(ctx, input.eventId, input.userId, input.placeId);
  if (current.version !== input.expectedVersion) throw new VersionConflictError('place');

  const p = input.patch;
  const next: Partial<SavedPlace> = {};
  if (p.name !== undefined) next.name = cleanPlaceName(p.name);
  if (p.description !== undefined) next.description = cleanOptionalText(p.description, MAX_PLACE_DESCRIPTION, 'Description') ?? '';
  if (p.address !== undefined) next.address = cleanOptionalText(p.address, MAX_PLACE_ADDRESS, 'Address');
  if (p.category !== undefined) {
    if (!(PLACE_CATEGORY_VALUES as readonly string[]).includes(p.category)) throw new DomainError('VALIDATION_FAILED', 'Choose a category from the list.');
    next.category = p.category;
  }
  if (p.status !== undefined) {
    if (!(PLACE_STATUS_VALUES as readonly string[]).includes(p.status)) throw new DomainError('VALIDATION_FAILED', 'Choose a status from the list.');
    next.status = p.status;
  }
  if (p.favourite !== undefined) next.favourite = p.favourite;
  if (p.rating !== undefined) next.rating = cleanRating(p.rating);
  if (p.tags !== undefined) next.tags = cleanTags(p.tags);
  if (p.latitude !== undefined || p.longitude !== undefined) {
    const coords = cleanCoordinates(p.latitude ?? null, p.longitude ?? null);
    next.latitude = coords.latitude;
    next.longitude = coords.longitude;
  }
  if (p.spaceId !== undefined) {
    await validateTargets(ctx, input.eventId, input.userId, p.spaceId, []);
    next.spaceId = p.spaceId;
    next.source = { type: p.spaceId ? 'VENUE_MAP' : 'MANUAL', reference: p.spaceId };
  }
  if (p.collectionIds !== undefined) {
    const collectionIds = [...new Set(p.collectionIds)];
    await validateTargets(ctx, input.eventId, input.userId, null, collectionIds);
    next.collectionIds = collectionIds;
  }
  const sealedNote = p.privateNote !== undefined ? seal(ctx, input.userId, input.placeId, cleanNote(p.privateNote)) : null;

  const now = ctx.now();
  const updated = await ctx.store.docMutate('places', input.placeId, (doc) => {
    if (doc.version !== input.expectedVersion || doc.ownerId !== input.userId || doc.eventId !== input.eventId) return null;
    return {
      ...doc,
      ...next,
      ...(sealedNote !== null ? { privateNoteSealed: sealedNote } : {}),
      updatedAt: now,
      updates: doc.updates + 1,
      version: doc.version + 1,
    };
  });
  if (!updated) throw new VersionConflictError('place');
  return view(ctx, updated);
}

export async function deletePlace(ctx: ServiceContext, input: { eventId: string; userId: string; placeId: string }): Promise<void> {
  await requireCapability(ctx, input.eventId, input.userId, 'event.read');
  await ownPlace(ctx, input.eventId, input.userId, input.placeId);
  await ctx.store.docDelete('places', input.placeId);
}

export async function createCollection(ctx: ServiceContext, eventId: string, userId: string, name: string): Promise<PlaceCollection> {
  await requireCapability(ctx, eventId, userId, 'event.read');
  const cleaned = cleanCollectionName(name);
  const existing = await ctx.store.docList('placeCollections', { eventId, ownerId: userId });
  if (existing.length >= MAX_COLLECTIONS_PER_OWNER) {
    throw new DomainError('VALIDATION_FAILED', `You can keep up to ${MAX_COLLECTIONS_PER_OWNER} collections for this event.`);
  }
  if (existing.some((collection) => collection.name.toLowerCase() === cleaned.toLowerCase())) {
    throw new DomainError('DUPLICATE', 'You already have a collection with that name.');
  }
  const collection: PlaceCollection = { id: ctx.newId('plcol'), eventId, ownerId: userId, name: cleaned, createdAt: ctx.now(), version: 1 };
  await ctx.store.docPut('placeCollections', collection);
  return collection;
}

export async function deleteCollection(ctx: ServiceContext, input: { eventId: string; userId: string; collectionId: string }): Promise<void> {
  await requireCapability(ctx, input.eventId, input.userId, 'event.read');
  const collection = await ctx.store.docGet('placeCollections', input.collectionId);
  if (!collection || collection.eventId !== input.eventId || collection.ownerId !== input.userId) {
    throw new DomainError('NOT_FOUND', 'Collection not found.');
  }
  // Deleting a collection removes it from the places, but never deletes the places themselves.
  for (const place of await ctx.store.docList('places', { eventId: input.eventId, ownerId: input.userId })) {
    if (place.collectionIds.includes(input.collectionId)) {
      await ctx.store.docMutate('places', place.id, (doc) => ({
        ...doc,
        collectionIds: doc.collectionIds.filter((id) => id !== input.collectionId),
        version: doc.version + 1,
      }));
    }
  }
  await ctx.store.docDelete('placeCollections', input.collectionId);
}

/** For the data export: the person's own places, with their notes opened for them. */
export async function exportPlaces(ctx: ServiceContext, userId: string) {
  const places = await ctx.store.docList('places', { ownerId: userId });
  const collections = await ctx.store.docList('placeCollections', { ownerId: userId });
  const visits = await ctx.store.docList('placeVisits', { ownerId: userId });
  const imports = await ctx.store.docList('placeImports', { ownerId: userId });
  return {
    visits: visits.map((visit) => ({ spaceId: visit.spaceId, eventId: visit.eventId, arrivedAt: new Date(visit.arrivedAt).toISOString(), departedAt: visit.departedAt === null ? null : new Date(visit.departedAt).toISOString(), corrected: visit.correctedAt !== null })),
    imports: imports.map((batch) => ({ fileName: batch.fileName, format: batch.format, eventId: batch.eventId, total: batch.total, saved: batch.saved, skipped: batch.skipped, failures: batch.failures, createdAt: new Date(batch.createdAt).toISOString() })),
    places: places.map((place) => ({
      name: place.name,
      eventId: place.eventId,
      category: place.category,
      status: place.status,
      favourite: place.favourite,
      rating: place.rating,
      note: ctx.vault.open(place.privateNoteSealed, noteContext(place.ownerId, place.id)),
      tags: place.tags,
      latitude: place.latitude,
      longitude: place.longitude,
      address: place.address,
      createdAt: new Date(place.createdAt).toISOString(),
      updatedAt: new Date(place.updatedAt).toISOString(),
    })),
    collections: collections.map((collection) => ({ name: collection.name, eventId: collection.eventId })),
  };
}

/** For erasure: removes every place and collection the person owns, in every event. Returns the number removed. */
export async function erasePlaces(ctx: ServiceContext, userId: string): Promise<number> {
  let removed = 0;
  for (const place of await ctx.store.docList('places', { ownerId: userId })) {
    if (await ctx.store.docDelete('places', place.id)) removed += 1;
  }
  for (const collection of await ctx.store.docList('placeCollections', { ownerId: userId })) {
    if (await ctx.store.docDelete('placeCollections', collection.id)) removed += 1;
  }
  for (const visit of await ctx.store.docList('placeVisits', { ownerId: userId })) {
    if (await ctx.store.docDelete('placeVisits', visit.id)) removed += 1;
  }
  for (const batch of await ctx.store.docList('placeImports', { ownerId: userId })) {
    if (await ctx.store.docDelete('placeImports', batch.id)) removed += 1;
  }
  return removed;
}
