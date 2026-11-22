import { z } from 'zod';
import { PLACE_CATEGORY_VALUES, PLACE_STATUS_VALUES } from '@/domain/places/rules';

/** Request bodies for the personal place routes. Business rules live in src/domain/places/rules.ts. */

export const PlaceBody = z.object({
  name: z.string().max(200),
  description: z.string().max(1000).nullable().optional(),
  category: z.enum(PLACE_CATEGORY_VALUES),
  spaceId: z.string().max(80).nullable().optional(),
  latitude: z.number().nullable().optional(),
  longitude: z.number().nullable().optional(),
  address: z.string().max(400).nullable().optional(),
  status: z.enum(PLACE_STATUS_VALUES).optional(),
  favourite: z.boolean().optional(),
  rating: z.number().nullable().optional(),
  privateNote: z.string().max(4000).nullable().optional(),
  collectionIds: z.array(z.string().max(80)).max(50).optional(),
  tags: z.array(z.string().max(60)).max(20).optional(),
});

export const PlaceActionBody = z.discriminatedUnion('action', [
  z.object({ action: z.literal('update'), expectedVersion: z.number().int().min(1), patch: PlaceBody.partial() }),
  z.object({ action: z.literal('delete') }),
]);

export const CollectionBody = z.object({ name: z.string().min(1).max(200) });

const MAX_IMPORT_CHARS = 2 * 1024 * 1024;

export const CaptureBody = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('TEXT'), text: z.string().max(4000) }),
  z.object({ kind: z.literal('LINK'), url: z.string().min(1).max(2000), name: z.string().max(80).nullable().optional() }),
  z.object({ kind: z.literal('IMPORT'), fileName: z.string().min(1).max(200), content: z.string().min(1).max(MAX_IMPORT_CHARS) }),
]);

const SaveCandidate = z.object({
  name: z.string().min(1).max(200),
  note: z.string().max(1000).nullable(),
  address: z.string().max(400).nullable(),
  latitude: z.number().nullable(),
  longitude: z.number().nullable(),
  spaceId: z.string().max(80).nullable(),
  tags: z.array(z.string().max(60)).max(20),
});

export const SaveBody = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('TEXT'), candidates: z.array(SaveCandidate).max(200) }),
  z.object({ kind: z.literal('LINK'), host: z.string().max(200).nullable(), candidates: z.array(SaveCandidate).max(200) }),
  z.object({ kind: z.literal('PHOTO'), candidates: z.array(SaveCandidate).max(1) }),
  z.object({
    kind: z.literal('IMPORT'),
    fileName: z.string().min(1).max(200),
    format: z.enum(['CSV', 'GEOJSON']),
    total: z.number().int().min(0).max(1000),
    failures: z.array(z.object({ line: z.number().int(), reason: z.string().max(300) })).max(1000),
    candidates: z.array(SaveCandidate).max(1000),
  }),
]);

export const VisitCheckInBody = z.object({
  spaceId: z.string().min(1).max(80),
  placeId: z.string().max(120).nullable().optional(),
});

export const VisitActionBody = z.discriminatedUnion('action', [
  z.object({ action: z.literal('end'), expectedVersion: z.number().int().min(1) }),
  z.object({
    action: z.literal('correct'),
    expectedVersion: z.number().int().min(1),
    arrivedAt: z.number(),
    departedAt: z.number().nullable(),
  }),
  z.object({ action: z.literal('delete') }),
]);
