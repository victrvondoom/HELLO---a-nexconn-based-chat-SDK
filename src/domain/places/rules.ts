import { DomainError } from '../errors';
import type { PlaceCategory, PlaceStatus, SavedPlace } from '../product';

/**
 * Personal place memory rules. Pure: no storage and no clock.
 *
 * A place belongs to one person and one event. Nothing here makes a place visible to anyone else: sharing is a
 * separate capability that does not exist yet, so every place is private.
 */

export const PLACE_STATUS_VALUES = ['SAVED', 'WANT_TO_VISIT', 'VISITED'] as const satisfies readonly PlaceStatus[];
export const PLACE_CATEGORY_VALUES = [
  'FOOD',
  'COFFEE',
  'SHOP',
  'CULTURE',
  'OUTDOORS',
  'TRANSPORT',
  'SERVICE',
  'WORK',
  'OTHER',
] as const satisfies readonly PlaceCategory[];

export const PLACE_STATUS_LABEL: Record<PlaceStatus, string> = {
  SAVED: 'Saved',
  WANT_TO_VISIT: 'Want to visit',
  VISITED: 'Visited',
};

export const PLACE_CATEGORY_LABEL: Record<PlaceCategory, string> = {
  FOOD: 'Food',
  COFFEE: 'Coffee',
  SHOP: 'Shop',
  CULTURE: 'Culture',
  OUTDOORS: 'Outdoors',
  TRANSPORT: 'Transport',
  SERVICE: 'Service',
  WORK: 'Work',
  OTHER: 'Other',
};

export const MAX_PLACE_NAME = 80;
export const MAX_PLACE_DESCRIPTION = 500;
export const MAX_PLACE_NOTE = 2000;
export const MAX_PLACE_ADDRESS = 200;
export const MAX_TAGS = 10;
export const MAX_TAG_LENGTH = 24;
export const MAX_COLLECTION_NAME = 60;
/** A person can keep this many places per event. A limit stops one account filling the store. */
export const MAX_PLACES_PER_OWNER = 500;
export const MAX_COLLECTIONS_PER_OWNER = 50;

function bounded(value: string, max: number, label: string): string {
  const cleaned = value.trim().replace(/\s+/g, ' ');
  if (cleaned.length === 0) throw new DomainError('VALIDATION_FAILED', `${label} is required.`);
  if (cleaned.length > max) throw new DomainError('VALIDATION_FAILED', `${label} must be ${max} characters or fewer.`);
  return cleaned;
}

export function cleanPlaceName(name: string): string {
  return bounded(name, MAX_PLACE_NAME, 'Name');
}

export function cleanOptionalText(value: string | null | undefined, max: number, label: string): string | null {
  if (value === null || value === undefined) return null;
  const cleaned = value.trim().replace(/\s+/g, ' ');
  if (cleaned.length === 0) return null;
  if (cleaned.length > max) throw new DomainError('VALIDATION_FAILED', `${label} must be ${max} characters or fewer.`);
  return cleaned;
}

export function cleanNote(note: string | null | undefined): string {
  if (note === null || note === undefined) return '';
  const trimmed = note.trim();
  if (trimmed.length > MAX_PLACE_NOTE) throw new DomainError('VALIDATION_FAILED', `The note must be ${MAX_PLACE_NOTE} characters or fewer.`);
  return trimmed;
}

/** Both coordinates or neither. Values must be real numbers inside the globe's range. */
export function cleanCoordinates(latitude: number | null, longitude: number | null): { latitude: number | null; longitude: number | null } {
  if (latitude === null && longitude === null) return { latitude: null, longitude: null };
  if (latitude === null || longitude === null) throw new DomainError('VALIDATION_FAILED', 'Give both latitude and longitude, or neither.');
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) throw new DomainError('VALIDATION_FAILED', 'Latitude must be between -90 and 90.');
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) throw new DomainError('VALIDATION_FAILED', 'Longitude must be between -180 and 180.');
  return { latitude: Math.round(latitude * 1e6) / 1e6, longitude: Math.round(longitude * 1e6) / 1e6 };
}

export function cleanRating(rating: number | null): number | null {
  if (rating === null) return null;
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw new DomainError('VALIDATION_FAILED', 'A rating is a whole number from 1 to 5.');
  return rating;
}

export function cleanTags(tags: readonly string[]): string[] {
  const cleaned = [...new Set(tags.map((tag) => tag.trim().toLowerCase().replace(/\s+/g, '-')).filter((tag) => tag.length > 0))];
  if (cleaned.length > MAX_TAGS) throw new DomainError('VALIDATION_FAILED', `Use at most ${MAX_TAGS} tags.`);
  if (cleaned.some((tag) => tag.length > MAX_TAG_LENGTH)) {
    throw new DomainError('VALIDATION_FAILED', `Each tag must be ${MAX_TAG_LENGTH} characters or fewer.`);
  }
  return cleaned;
}

export function cleanCollectionName(name: string): string {
  return bounded(name, MAX_COLLECTION_NAME, 'Collection name');
}

/** Places a person sees, filtered and ordered. Favourites come first, then the most recently changed. */
/** The fields filtering and ordering read. Both stored records and the owner's views have them. */
export type FilterablePlace = Pick<SavedPlace, 'id' | 'name' | 'description' | 'address' | 'category' | 'tags' | 'status' | 'favourite' | 'collectionIds' | 'updatedAt'>;

export function filterPlaces<T extends FilterablePlace>(
  places: readonly T[],
  filter: { status?: PlaceStatus | null; favouritesOnly?: boolean; collectionId?: string | null; query?: string },
): T[] {
  const query = (filter.query ?? '').trim().toLowerCase();
  return places
    .filter((place) => (filter.status ? place.status === filter.status : true))
    .filter((place) => (filter.favouritesOnly ? place.favourite : true))
    .filter((place) => (filter.collectionId ? place.collectionIds.includes(filter.collectionId) : true))
    .filter((place) => {
      if (query.length === 0) return true;
      const haystack = [place.name, place.description, place.address ?? '', place.category, ...place.tags].join(' ').toLowerCase();
      return haystack.includes(query);
    })
    .sort((a, b) => Number(b.favourite) - Number(a.favourite) || b.updatedAt - a.updatedAt || (a.id < b.id ? -1 : 1));
}

/** The sealing context binds a sealed note to its owner and place, so one note cannot be moved onto another record. */
export function noteContext(ownerId: string, placeId: string): string {
  return `place-note:${ownerId}:${placeId}`;
}
