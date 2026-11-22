import { describe, expect, it } from 'vitest';
import { createHarness } from './harness';
import { DomainError } from '@/domain/errors';
import { createCollection, createPlace, deleteCollection, deletePlace, listMyPlaces, updatePlace } from '@/services/places';
import { eraseMe, exportMyData } from '@/services/rights';
import { noteContext } from '@/domain/places/rules';

async function expectDomainError(promise: Promise<unknown>, code: string): Promise<void> {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(DomainError);
  expect((error as DomainError).code).toBe(code);
}

describe('My places: creating and reading', () => {
  it('saves a place with its note sealed at rest, and returns the note only to its owner', async () => {
    const h = await createHarness();
    const ada = h.users.attendeeAda;
    const place = await createPlace(h.ctx, h.eventId, ada, {
      name: 'Coffee by the atrium',
      category: 'COFFEE',
      spaceId: 'sp-atrium',
      privateNote: 'Ask for the window seat',
      tags: ['Quiet', ' Work '],
    });
    expect(place.privateNote).toBe('Ask for the window seat');
    expect(place.tags).toEqual(['quiet', 'work']);
    expect(place.source).toEqual({ type: 'VENUE_MAP', reference: 'sp-atrium' });
    expect(place.visibility).toBe('PRIVATE');

    const stored = await h.store.docGet('places', place.id);
    if (!stored) throw new Error('the saved place is missing from the store');
    expect(JSON.stringify(stored)).not.toContain('window seat');
    expect(h.ctx.vault.open(stored.privateNoteSealed, noteContext(ada, place.id))).toBe('Ask for the window seat');
  });

  it('never lists another person’s places to anyone else', async () => {
    const h = await createHarness();
    await createPlace(h.ctx, h.eventId, h.users.attendeeAda, { name: 'Ada’s secret bench', category: 'OUTDOORS', privateNote: 'Private' });
    const bens = await listMyPlaces(h.ctx, h.eventId, h.users.attendeeBen);
    expect(bens.places).toHaveLength(0);
    const adas = await listMyPlaces(h.ctx, h.eventId, h.users.attendeeAda);
    expect(adas.places.map((p) => p.name)).toEqual(['Ada’s secret bench']);
  });

  it('refuses a place on a venue space that does not exist, and bad coordinates', async () => {
    const h = await createHarness();
    const ada = h.users.attendeeAda;
    await expectDomainError(createPlace(h.ctx, h.eventId, ada, { name: 'Nowhere', category: 'OTHER', spaceId: 'sp-missing' }), 'VALIDATION_FAILED');
    await expectDomainError(createPlace(h.ctx, h.eventId, ada, { name: 'Half a point', category: 'OTHER', latitude: 51.5 }), 'VALIDATION_FAILED');
    await expectDomainError(createPlace(h.ctx, h.eventId, ada, { name: 'Off the globe', category: 'OTHER', latitude: 91, longitude: 0 }), 'VALIDATION_FAILED');
    await expectDomainError(createPlace(h.ctx, h.eventId, ada, { name: '  ', category: 'OTHER' }), 'VALIDATION_FAILED');
  });

  it('accepts coordinates the owner types, rounded to six decimal places', async () => {
    const h = await createHarness();
    const place = await createPlace(h.ctx, h.eventId, h.users.attendeeAda, { name: 'Beach', category: 'OUTDOORS', latitude: 38.7071234567, longitude: -9.1355 });
    expect(place.latitude).toBe(38.707123);
    expect(place.longitude).toBe(-9.1355);
    expect(place.spaceId).toBeNull();
    expect(place.source.type).toBe('MANUAL');
  });
});

describe('My places: editing', () => {
  it('applies an edit made from the version the owner read, and counts the update', async () => {
    const h = await createHarness();
    const ada = h.users.attendeeAda;
    const place = await createPlace(h.ctx, h.eventId, ada, { name: 'Noodles', category: 'FOOD' });
    const updated = await updatePlace(h.ctx, { eventId: h.eventId, userId: ada, placeId: place.id, expectedVersion: place.version, patch: { rating: 4, favourite: true } });
    expect(updated.rating).toBe(4);
    expect(updated.favourite).toBe(true);
    expect(updated.version).toBe(place.version + 1);
    expect(updated.updates).toBe(1);
    expect(updated.createdAt).toBe(place.createdAt);
  });

  it('refuses an edit made from an out-of-date version, so two open tabs cannot overwrite each other', async () => {
    const h = await createHarness();
    const ada = h.users.attendeeAda;
    const place = await createPlace(h.ctx, h.eventId, ada, { name: 'Noodles', category: 'FOOD' });
    await updatePlace(h.ctx, { eventId: h.eventId, userId: ada, placeId: place.id, expectedVersion: place.version, patch: { status: 'VISITED' } });
    await expectDomainError(
      updatePlace(h.ctx, { eventId: h.eventId, userId: ada, placeId: place.id, expectedVersion: place.version, patch: { status: 'WANT_TO_VISIT' } }),
      'VERSION_CONFLICT',
    );
    const current = (await listMyPlaces(h.ctx, h.eventId, ada)).places[0];
    expect(current?.status).toBe('VISITED');
  });

  it('will not let another person edit or delete a place, and reports it as not found', async () => {
    const h = await createHarness();
    const place = await createPlace(h.ctx, h.eventId, h.users.attendeeAda, { name: 'Noodles', category: 'FOOD' });
    await expectDomainError(
      updatePlace(h.ctx, { eventId: h.eventId, userId: h.users.attendeeBen, placeId: place.id, expectedVersion: place.version, patch: { name: 'Hijacked' } }),
      'NOT_FOUND',
    );
    await expectDomainError(deletePlace(h.ctx, { eventId: h.eventId, userId: h.users.attendeeBen, placeId: place.id }), 'NOT_FOUND');
    expect((await h.store.docGet('places', place.id))?.name).toBe('Noodles');
  });

  it('deletes the owner’s place', async () => {
    const h = await createHarness();
    const ada = h.users.attendeeAda;
    const place = await createPlace(h.ctx, h.eventId, ada, { name: 'Noodles', category: 'FOOD' });
    await deletePlace(h.ctx, { eventId: h.eventId, userId: ada, placeId: place.id });
    expect((await listMyPlaces(h.ctx, h.eventId, ada)).places).toHaveLength(0);
  });
});

describe('My places: collections', () => {
  it('creates a collection, files places into it, and refuses a duplicate name', async () => {
    const h = await createHarness();
    const ada = h.users.attendeeAda;
    const food = await createCollection(h.ctx, h.eventId, ada, 'Food to try');
    await expectDomainError(createCollection(h.ctx, h.eventId, ada, 'food to try'), 'DUPLICATE');
    const place = await createPlace(h.ctx, h.eventId, ada, { name: 'Noodles', category: 'FOOD', collectionIds: [food.id] });
    expect(place.collectionIds).toEqual([food.id]);
  });

  it('refuses to file a place into another person’s collection', async () => {
    const h = await createHarness();
    const adasList = await createCollection(h.ctx, h.eventId, h.users.attendeeAda, 'Ada only');
    await expectDomainError(
      createPlace(h.ctx, h.eventId, h.users.attendeeBen, { name: 'Sneaky', category: 'OTHER', collectionIds: [adasList.id] }),
      'VALIDATION_FAILED',
    );
  });

  it('deleting a collection keeps its places and removes only the grouping', async () => {
    const h = await createHarness();
    const ada = h.users.attendeeAda;
    const food = await createCollection(h.ctx, h.eventId, ada, 'Food to try');
    const place = await createPlace(h.ctx, h.eventId, ada, { name: 'Noodles', category: 'FOOD', collectionIds: [food.id] });
    await deleteCollection(h.ctx, { eventId: h.eventId, userId: ada, collectionId: food.id });
    const listing = await listMyPlaces(h.ctx, h.eventId, ada);
    expect(listing.collections).toHaveLength(0);
    expect(listing.places.find((p) => p.id === place.id)?.collectionIds).toEqual([]);
  });
});

describe('My places: rights', () => {
  it('includes the person’s places and notes in their data export', async () => {
    const h = await createHarness();
    const ada = h.users.attendeeAda;
    await createPlace(h.ctx, h.eventId, ada, { name: 'Noodles', category: 'FOOD', privateNote: 'Order the spicy one' });
    const exported = await exportMyData(h.ctx, ada);
    expect(exported.placeMemory.places).toHaveLength(1);
    expect(exported.placeMemory.places[0]?.note).toBe('Order the spicy one');
  });

  it('removes the person’s places and collections when their data is erased', async () => {
    const h = await createHarness();
    const ada = h.users.attendeeAda;
    const food = await createCollection(h.ctx, h.eventId, ada, 'Food to try');
    await createPlace(h.ctx, h.eventId, ada, { name: 'Noodles', category: 'FOOD', collectionIds: [food.id] });
    const report = await eraseMe(h.ctx, ada);
    expect(report.placeRecords).toBe(2);
    expect(await h.store.docList('places', { ownerId: ada })).toHaveLength(0);
    expect(await h.store.docList('placeCollections', { ownerId: ada })).toHaveLength(0);
  });
});
