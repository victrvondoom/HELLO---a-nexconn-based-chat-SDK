import { describe, expect, it } from 'vitest';
import { cleanCoordinates, cleanRating, cleanTags, filterPlaces, noteContext } from '@/domain/places/rules';
import type { SavedPlace } from '@/domain/product';

function place(id: string, overrides: Partial<SavedPlace> = {}): SavedPlace {
  return {
    id,
    eventId: 'evt',
    ownerId: 'u-ada',
    name: id,
    description: '',
    category: 'FOOD',
    spaceId: null,
    latitude: null,
    longitude: null,
    address: null,
    status: 'SAVED',
    favourite: false,
    rating: null,
    privateNoteSealed: '',
    collectionIds: [],
    tags: [],
    source: { type: 'MANUAL', reference: null },
    visibility: 'PRIVATE',
    createdAt: 1,
    updatedAt: 1,
    updates: 0,
    version: 1,
    ...overrides,
  };
}

describe('coordinates', () => {
  it('accepts neither, or both within range, and rounds to six decimals', () => {
    expect(cleanCoordinates(null, null)).toEqual({ latitude: null, longitude: null });
    expect(cleanCoordinates(38.7071234567, -9.1355)).toEqual({ latitude: 38.707123, longitude: -9.1355 });
  });

  it('refuses one coordinate alone, and values outside the globe', () => {
    expect(() => cleanCoordinates(10, null)).toThrow();
    expect(() => cleanCoordinates(91, 0)).toThrow();
    expect(() => cleanCoordinates(0, 181)).toThrow();
    expect(() => cleanCoordinates(Number.NaN, 0)).toThrow();
  });
});

describe('ratings and tags', () => {
  it('allows no rating or a whole number from one to five only', () => {
    expect(cleanRating(null)).toBeNull();
    expect(cleanRating(5)).toBe(5);
    expect(() => cleanRating(0)).toThrow();
    expect(() => cleanRating(6)).toThrow();
    expect(() => cleanRating(2.5)).toThrow();
  });

  it('normalises tags, removes duplicates and enforces the limits', () => {
    expect(cleanTags([' Quiet ', 'quiet', 'Work Spot'])).toEqual(['quiet', 'work-spot']);
    expect(() => cleanTags(Array.from({ length: 11 }, (_, i) => `tag${i}`))).toThrow();
    expect(() => cleanTags(['x'.repeat(25)])).toThrow();
  });
});

describe('filterPlaces', () => {
  const places = [
    place('a', { name: 'Noodles', tags: ['spicy'], updatedAt: 1 }),
    place('b', { name: 'Gallery', category: 'CULTURE', favourite: true, updatedAt: 2 }),
    place('c', { name: 'Harbour walk', address: 'Quay 9', status: 'WANT_TO_VISIT', collectionIds: ['col-1'], updatedAt: 3 }),
  ];

  it('puts favourites first, then the most recently changed', () => {
    expect(filterPlaces(places, {}).map((p) => p.id)).toEqual(['b', 'c', 'a']);
  });

  it('matches the search across name, tags, kind and address', () => {
    expect(filterPlaces(places, { query: 'spicy' }).map((p) => p.id)).toEqual(['a']);
    expect(filterPlaces(places, { query: 'quay' }).map((p) => p.id)).toEqual(['c']);
    expect(filterPlaces(places, { query: 'culture' }).map((p) => p.id)).toEqual(['b']);
  });

  it('filters by status, favourites and collection, and does not change the input', () => {
    expect(filterPlaces(places, { status: 'WANT_TO_VISIT' }).map((p) => p.id)).toEqual(['c']);
    expect(filterPlaces(places, { favouritesOnly: true }).map((p) => p.id)).toEqual(['b']);
    expect(filterPlaces(places, { collectionId: 'col-1' }).map((p) => p.id)).toEqual(['c']);
    expect(places.map((p) => p.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('note sealing context', () => {
  it('differs for every place and owner, so a sealed note cannot be moved onto another record', () => {
    expect(noteContext('u-ada', 'plc-1')).not.toBe(noteContext('u-ada', 'plc-2'));
    expect(noteContext('u-ada', 'plc-1')).not.toBe(noteContext('u-ben', 'plc-1'));
  });
});
