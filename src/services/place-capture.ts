import { DomainError } from '../domain/errors';
import type { PlaceSource } from '../domain/product';
import {
  MAX_IMPORT_BYTES,
  MAX_PHOTO_BYTES,
  findMentions,
  findTimeHints,
  parseImport,
  parseMapLink,
  readPhotoLocation,
  type CaptureFailure,
  type KnownPlace,
} from '../domain/places/capture';
import { requireCapability, type ServiceContext } from './context';
import { createPlace, listMyPlaces, type PlaceView } from './places';

/**
 * Capture: finds place candidates from text, links, files and photo metadata, shows them, and saves only what the
 * person selects. Previews never write. Every candidate carries where it came from, in words.
 */

export interface CaptureCandidate {
  key: string;
  name: string;
  note: string | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  spaceId: string | null;
  tags: string[];
  /** Set when the same name at the same position is already in the person's list. */
  duplicateOf: string | null;
  sourceLabel: string;
}

export interface CapturePreview {
  kind: 'TEXT' | 'LINK' | 'IMPORT' | 'PHOTO';
  candidates: CaptureCandidate[];
  failures: CaptureFailure[];
  timeHints: string[];
  format: 'CSV' | 'GEOJSON' | null;
  /** Plain words for the person: what was found, or why nothing was. */
  message: string;
}

export type CaptureInput =
  | { kind: 'TEXT'; text: string }
  | { kind: 'LINK'; url: string; name?: string | null }
  | { kind: 'IMPORT'; fileName: string; content: string };

/** The places a person can refer to: the venue's spaces and points of interest, and their own saved places. */
export async function knownPlacesFor(ctx: ServiceContext, eventId: string, userId: string): Promise<KnownPlace[]> {
  const venue = await ctx.store.getVenue(eventId);
  const mine = await listMyPlaces(ctx, eventId, userId);
  const known: KnownPlace[] = [];
  for (const space of venue?.spaces ?? []) {
    known.push({ name: space.name, source: 'VENUE_SPACE', ref: space.id, spaceId: space.id, latitude: null, longitude: null });
  }
  for (const poi of venue?.pois ?? []) {
    known.push({ name: poi.name, source: 'VENUE_POI', ref: poi.id, spaceId: null, latitude: null, longitude: null });
  }
  for (const place of mine.places) {
    known.push({ name: place.name, source: 'SAVED_PLACE', ref: place.id, spaceId: place.spaceId, latitude: place.latitude, longitude: place.longitude });
  }
  return known;
}

function duplicateOf(existing: readonly PlaceView[], name: string, latitude: number | null, longitude: number | null): string | null {
  const wanted = name.trim().toLowerCase();
  const hit = existing.find((place) => place.name.trim().toLowerCase() === wanted && place.latitude === latitude && place.longitude === longitude);
  return hit ? hit.id : null;
}

export async function previewCapture(ctx: ServiceContext, eventId: string, userId: string, input: CaptureInput): Promise<CapturePreview> {
  await requireCapability(ctx, eventId, userId, 'event.read');
  const mine = await listMyPlaces(ctx, eventId, userId);

  if (input.kind === 'TEXT') {
    const text = input.text.trim();
    if (text.length === 0) throw new DomainError('VALIDATION_FAILED', 'Paste some text to look for places in.');
    const known = await knownPlacesFor(ctx, eventId, userId);
    const mentions = findMentions(text, known);
    const timeHints = findTimeHints(text);
    const candidates: CaptureCandidate[] = mentions.map((mention) => ({
      key: `${mention.source}:${mention.ref}`,
      name: mention.name,
      note: null,
      address: null,
      latitude: mention.latitude,
      longitude: mention.longitude,
      spaceId: mention.spaceId,
      tags: [],
      duplicateOf: mention.source === 'SAVED_PLACE' ? mention.ref : duplicateOf(mine.places, mention.name, mention.latitude, mention.longitude),
      sourceLabel: `Named in your text as “${mention.matchedText}” (${mention.source === 'VENUE_SPACE' ? 'venue map' : mention.source === 'VENUE_POI' ? 'venue point of interest' : 'your saved places'})`,
    }));
    return {
      kind: 'TEXT',
      candidates,
      failures: [],
      timeHints,
      format: null,
      message:
        candidates.length > 0
          ? `Found ${candidates.length} place${candidates.length === 1 ? '' : 's'} that the text names. Review them before saving.`
          : 'No place that HELLO knows is named in this text. Type the name, or paste a Google Maps link.',
    };
  }

  if (input.kind === 'LINK') {
    const url = input.url.trim();
    const parsed = parseMapLink(url);
    if (parsed) {
      const name = parsed.name ?? input.name?.trim() ?? '';
      if (name.length === 0) {
        return {
          kind: 'LINK',
          candidates: [],
          failures: [{ line: 1, reason: 'The link has coordinates but no place name. Type a name for it.' }],
          timeHints: [],
          format: null,
          message: 'Type a name for this place, then check again.',
        };
      }
      const candidate: CaptureCandidate = {
        key: 'link',
        name,
        note: null,
        address: null,
        latitude: parsed.latitude,
        longitude: parsed.longitude,
        spaceId: null,
        tags: [],
        duplicateOf: duplicateOf(mine.places, name, parsed.latitude, parsed.longitude),
        sourceLabel: 'Read from the Google Maps link you pasted',
      };
      return { kind: 'LINK', candidates: [candidate], failures: [], timeHints: [], format: null, message: 'Review the place from this link before saving.' };
    }
    // A link that is not a recognised map link is kept only when the person names it. HELLO never fetches the page.
    if (/^https?:\/\//i.test(url) && input.name && input.name.trim().length > 0) {
      const name = input.name.trim();
      return {
        kind: 'LINK',
        candidates: [
          {
            key: 'link',
            name,
            note: null,
            address: null,
            latitude: null,
            longitude: null,
            spaceId: null,
            tags: [],
            duplicateOf: duplicateOf(mine.places, name, null, null),
            sourceLabel: 'Named by you from a link you pasted (the page was not opened)',
          },
        ],
        failures: [],
        timeHints: [],
        format: null,
        message: 'Review the place before saving. HELLO did not open the link.',
      };
    }
    return {
      kind: 'LINK',
      candidates: [],
      failures: [{ line: 1, reason: 'That is not a Google Maps place link. Paste a link with coordinates, or name the place yourself.' }],
      timeHints: [],
      format: null,
      message: 'No place could be read from that link.',
    };
  }

  // IMPORT
  if (input.content.length > MAX_IMPORT_BYTES) {
    throw new DomainError('VALIDATION_FAILED', 'That file is too large. Split it into smaller files.');
  }
  const parsed = parseImport(input.content);
  const candidates: CaptureCandidate[] = parsed.rows.map((row) => ({
    key: `row-${row.line}`,
    name: row.name,
    note: row.note,
    address: row.address,
    latitude: row.latitude,
    longitude: row.longitude,
    spaceId: null,
    tags: row.tags,
    duplicateOf: duplicateOf(mine.places, row.name, row.latitude, row.longitude),
    sourceLabel: `Row ${row.line} of ${input.fileName}`,
  }));
  const unread = parsed.failures.length;
  return {
    kind: 'IMPORT',
    candidates,
    failures: parsed.failures,
    timeHints: [],
    format: parsed.format,
    message:
      candidates.length === 0
        ? 'No place could be read from this file.'
        : `Read ${candidates.length} place${candidates.length === 1 ? '' : 's'} from ${input.fileName}${unread > 0 ? `; ${unread} row${unread === 1 ? '' : 's'} could not be read` : ''}. Choose which to save.`,
  };
}

/**
 * Reads the location a photo carries. The photo is not stored, and its other metadata is not read. The person sees
 * the coordinates before anything is saved.
 */
export async function previewPhoto(ctx: ServiceContext, eventId: string, userId: string, bytes: Uint8Array): Promise<CapturePreview> {
  await requireCapability(ctx, eventId, userId, 'event.read');
  if (bytes.length > MAX_PHOTO_BYTES) throw new DomainError('VALIDATION_FAILED', 'That photo is too large. Choose a smaller one.');
  const location = readPhotoLocation(bytes);
  if (!location) {
    return {
      kind: 'PHOTO',
      candidates: [],
      failures: [],
      timeHints: [],
      format: null,
      message: 'This photo has no location information, so there is nothing to save from it.',
    };
  }
  const mine = await listMyPlaces(ctx, eventId, userId);
  const day = location.takenAt ? location.takenAt.slice(0, 10) : null;
  // The file name is never used: names can carry personal details, so only the date the camera recorded is kept.
  const name = day ? `Photo spot, ${day}` : 'Photo spot';
  return {
    kind: 'PHOTO',
    candidates: [
      {
        key: 'photo',
        name,
        note: null,
        address: null,
        latitude: location.latitude,
        longitude: location.longitude,
        spaceId: null,
        tags: [],
        duplicateOf: duplicateOf(mine.places, name, location.latitude, location.longitude),
        sourceLabel: 'Location stored in the photo’s metadata. The photo itself is not saved.',
      },
    ],
    failures: [],
    timeHints: [],
    format: null,
    message: 'The photo carries a location. Review the coordinates before saving; the photo itself is not kept.',
  };
}

export interface SaveCandidate {
  name: string;
  note: string | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  spaceId: string | null;
  tags: string[];
}

export type SaveInput =
  | { kind: 'TEXT'; candidates: SaveCandidate[] }
  | { kind: 'LINK'; host: string | null; candidates: SaveCandidate[] }
  | { kind: 'PHOTO'; candidates: SaveCandidate[] }
  | {
      kind: 'IMPORT';
      fileName: string;
      format: 'CSV' | 'GEOJSON';
      total: number;
      failures: CaptureFailure[];
      candidates: SaveCandidate[];
    };

export interface SaveResult {
  saved: PlaceView[];
  skipped: Array<{ name: string; reason: string }>;
  importId: string | null;
}

function sourceFor(input: SaveInput, importId: string | null): { type: PlaceSource; reference: string | null } {
  switch (input.kind) {
    case 'TEXT':
      return { type: 'MESSAGE', reference: null };
    case 'LINK':
      return { type: 'LINK', reference: input.host };
    case 'PHOTO':
      return { type: 'PHOTO', reference: null };
    case 'IMPORT':
      return { type: 'IMPORT', reference: importId };
  }
}

/**
 * Saves the candidates the person chose. A candidate that is already saved is skipped, not duplicated; a candidate
 * the place rules refuse is reported with the reason and the rest still save. Imports are recorded with their
 * counts and the rows that could not be read.
 */
export async function savePlaces(ctx: ServiceContext, eventId: string, userId: string, input: SaveInput): Promise<SaveResult> {
  await requireCapability(ctx, eventId, userId, 'event.read');
  const importId = input.kind === 'IMPORT' ? ctx.newId('plimp') : null;
  const saved: PlaceView[] = [];
  const skipped: Array<{ name: string; reason: string }> = [];
  const source = sourceFor(input, importId);
  const existing: PlaceView[] = [...(await listMyPlaces(ctx, eventId, userId)).places];

  for (const candidate of input.candidates) {
    if (duplicateOf(existing, candidate.name, candidate.latitude, candidate.longitude) !== null) {
      skipped.push({ name: candidate.name, reason: 'Already in My places' });
      continue;
    }
    try {
      const place = await createPlace(ctx, eventId, userId, {
        name: candidate.name,
        description: candidate.note,
        category: 'OTHER',
        spaceId: candidate.spaceId,
        latitude: candidate.latitude,
        longitude: candidate.longitude,
        address: candidate.address,
        tags: candidate.tags,
        source,
      });
      saved.push(place);
      existing.push(place);
    } catch (error: unknown) {
      skipped.push({ name: candidate.name, reason: error instanceof DomainError ? error.message : 'This place could not be saved.' });
    }
  }

  if (input.kind === 'IMPORT' && importId) {
    await ctx.store.docPut('placeImports', {
      id: importId,
      eventId,
      ownerId: userId,
      fileName: input.fileName,
      format: input.format,
      total: input.total,
      saved: saved.length,
      skipped: skipped.length,
      failures: input.failures.slice(0, 100),
      createdAt: ctx.now(),
      version: 1,
    });
  }
  return { saved, skipped, importId };
}
