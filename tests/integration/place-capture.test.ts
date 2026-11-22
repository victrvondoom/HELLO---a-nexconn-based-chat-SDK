import { describe, expect, it } from 'vitest';
import { createHarness } from './harness';
import { DomainError } from '@/domain/errors';
import { previewCapture, previewPhoto, savePlaces } from '@/services/place-capture';
import { checkIn, correctVisit, deleteVisit, endVisit } from '@/services/place-visits';
import { listMyPlaces } from '@/services/places';
import { publishKey } from '@/services/private-messages';
import { exportMyData } from '@/services/rights';
import { jpegWithGps, jpegWithoutLocation } from '../helpers/jpeg';
import { generateKeyPairSync } from 'node:crypto';

async function expectDomainError(promise: Promise<unknown>, code: string): Promise<void> {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(DomainError);
  expect((error as DomainError).code).toBe(code);
}

describe('Capture from text', () => {
  it('suggests the venue places a message names, and saves only what the person picks', async () => {
    const h = await createHarness();
    const ada = h.users.attendeeAda;
    const preview = await previewCapture(h.ctx, h.eventId, ada, { kind: 'TEXT', text: 'Lets meet at the Atrium after 5' });
    expect(preview.candidates.map((c) => c.name)).toEqual(['Atrium']);
    expect(preview.timeHints).toContain('after 5');
    expect((await listMyPlaces(h.ctx, h.eventId, ada)).places).toHaveLength(0);

    const result = await savePlaces(h.ctx, h.eventId, ada, { kind: 'TEXT', candidates: preview.candidates.map((c) => ({ ...c, note: null, address: null, tags: [] })) });
    expect(result.saved).toHaveLength(1);
    expect(result.saved[0]?.source).toEqual({ type: 'MESSAGE', reference: null });
    expect(result.saved[0]?.spaceId).toBe('sp-atrium');
  });

  it('does not save the same place twice, and says why it skipped it', async () => {
    const h = await createHarness();
    const ada = h.users.attendeeAda;
    const preview = await previewCapture(h.ctx, h.eventId, ada, { kind: 'TEXT', text: 'The Atrium again' });
    const candidate = { name: 'Atrium', note: null, address: null, latitude: null, longitude: null, spaceId: 'sp-atrium', tags: [] };
    await savePlaces(h.ctx, h.eventId, ada, { kind: 'TEXT', candidates: [candidate] });
    const again = await savePlaces(h.ctx, h.eventId, ada, { kind: 'TEXT', candidates: [candidate] });
    expect(again.saved).toHaveLength(0);
    expect(again.skipped[0]?.reason).toBe('Already in My places');
    expect(preview.candidates).toHaveLength(1);
  });

  it('says plainly when nothing is named, and refuses empty text', async () => {
    const h = await createHarness();
    const none = await previewCapture(h.ctx, h.eventId, h.users.attendeeAda, { kind: 'TEXT', text: 'Somewhere nice later' });
    expect(none.candidates).toHaveLength(0);
    expect(none.message).toMatch(/No place/);
    await expectDomainError(previewCapture(h.ctx, h.eventId, h.users.attendeeAda, { kind: 'TEXT', text: '   ' }), 'VALIDATION_FAILED');
  });
});

describe('Capture from a link', () => {
  it('reads a Google Maps place link and saves it with the host as its source', async () => {
    const h = await createHarness();
    const ada = h.users.attendeeAda;
    const preview = await previewCapture(h.ctx, h.eventId, ada, {
      kind: 'LINK',
      url: 'https://www.google.com/maps/place/Elliot%27s+Beach/@38.7071,-9.1355,15z',
    });
    expect(preview.candidates[0]).toMatchObject({ name: "Elliot's Beach", latitude: 38.7071, longitude: -9.1355 });
    const result = await savePlaces(h.ctx, h.eventId, ada, {
      kind: 'LINK',
      host: 'www.google.com',
      candidates: preview.candidates.map((c) => ({ ...c, note: null, address: null, tags: [] })),
    });
    expect(result.saved[0]?.source).toEqual({ type: 'LINK', reference: 'www.google.com' });
    expect(result.saved[0]?.latitude).toBe(38.7071);
  });

  it('keeps a non-map link only when the person names it, and never opens it', async () => {
    const h = await createHarness();
    const named = await previewCapture(h.ctx, h.eventId, h.users.attendeeAda, { kind: 'LINK', url: 'https://example.com/guide', name: 'Guide spot' });
    expect(named.candidates[0]?.name).toBe('Guide spot');
    expect(named.message).toMatch(/did not open/);
    const unnamed = await previewCapture(h.ctx, h.eventId, h.users.attendeeAda, { kind: 'LINK', url: 'https://example.com/guide' });
    expect(unnamed.candidates).toHaveLength(0);
    expect(unnamed.failures).toHaveLength(1);
  });
});

describe('Capture from an import file', () => {
  const csv = ['Title,Note,URL', 'Noodles,Spicy,"https://www.google.com/maps/place/Noodles/@38.7,-9.1,15z"', ',broken,', 'Harbour walk,,'].join('\n');

  it('previews each row with its source line, and records the rows it could not read', async () => {
    const h = await createHarness();
    const preview = await previewCapture(h.ctx, h.eventId, h.users.attendeeAda, { kind: 'IMPORT', fileName: 'saved.csv', content: csv });
    expect(preview.candidates.map((c) => c.name)).toEqual(['Noodles', 'Harbour walk']);
    expect(preview.candidates[0]?.sourceLabel).toBe('Row 2 of saved.csv');
    expect(preview.failures).toEqual([{ line: 3, reason: 'This row has no title.' }]);
  });

  it('saves the chosen rows, records the import with its counts and failures, and marks them duplicates on a second preview', async () => {
    const h = await createHarness();
    const ada = h.users.attendeeAda;
    const preview = await previewCapture(h.ctx, h.eventId, ada, { kind: 'IMPORT', fileName: 'saved.csv', content: csv });
    const result = await savePlaces(h.ctx, h.eventId, ada, {
      kind: 'IMPORT',
      fileName: 'saved.csv',
      format: 'CSV',
      total: preview.candidates.length,
      failures: preview.failures,
      candidates: preview.candidates.map((c) => ({ name: c.name, note: c.note, address: c.address, latitude: c.latitude, longitude: c.longitude, spaceId: null, tags: c.tags })),
    });
    expect(result.saved).toHaveLength(2);
    expect(result.saved.every((p) => p.source.type === 'IMPORT' && p.source.reference === result.importId)).toBe(true);

    const listing = await listMyPlaces(h.ctx, h.eventId, ada);
    expect(listing.imports[0]).toMatchObject({ fileName: 'saved.csv', saved: 2, skipped: 0, total: 2 });
    expect(listing.imports[0]?.failures).toEqual([{ line: 3, reason: 'This row has no title.' }]);

    const again = await previewCapture(h.ctx, h.eventId, ada, { kind: 'IMPORT', fileName: 'saved.csv', content: csv });
    expect(again.candidates.every((c) => c.duplicateOf !== null)).toBe(true);
  });

  it('refuses an import that is larger than the limit', async () => {
    const h = await createHarness();
    await expectDomainError(
      previewCapture(h.ctx, h.eventId, h.users.attendeeAda, { kind: 'IMPORT', fileName: 'big.csv', content: 'x'.repeat(2 * 1024 * 1024 + 1) }),
      'VALIDATION_FAILED',
    );
  });
});

describe('Capture from a photo', () => {
  it('reads the location a photo carries, without storing the photo', async () => {
    const h = await createHarness();
    const photo = jpegWithGps({ latitude: [38, 42, 30], latSign: 'N', longitude: [9, 8, 0], lngSign: 'W' });
    const preview = await previewPhoto(h.ctx, h.eventId, h.users.attendeeAda, photo);
    expect(preview.candidates).toHaveLength(1);
    expect(preview.candidates[0]?.sourceLabel).toMatch(/not saved/);
    expect((await listMyPlaces(h.ctx, h.eventId, h.users.attendeeAda)).places).toHaveLength(0);
  });

  it('says so when a photo has no location', async () => {
    const h = await createHarness();
    const preview = await previewPhoto(h.ctx, h.eventId, h.users.attendeeAda, jpegWithoutLocation());
    expect(preview.candidates).toHaveLength(0);
    expect(preview.message).toMatch(/no location/);
  });

  it('saves a photo location with the photo as its source, and nothing else from the photo', async () => {
    const h = await createHarness();
    const photo = jpegWithGps({ latitude: [38, 42, 30], latSign: 'N', longitude: [9, 8, 0], lngSign: 'W' });
    const preview = await previewPhoto(h.ctx, h.eventId, h.users.attendeeAda, photo);
    const result = await savePlaces(h.ctx, h.eventId, h.users.attendeeAda, {
      kind: 'PHOTO',
      candidates: preview.candidates.map((c) => ({ name: c.name, note: null, address: null, latitude: c.latitude, longitude: c.longitude, spaceId: null, tags: [] })),
    });
    expect(result.saved[0]?.source).toEqual({ type: 'PHOTO', reference: null });
    const exported = await exportMyData(h.ctx, h.users.attendeeAda);
    expect(JSON.stringify(exported.placeMemory)).not.toContain('IMG_0001');
  });
});

describe('Visits (check-in)', () => {
  it('records a check-in at a venue place, and a new check-in ends the previous visit', async () => {
    const h = await createHarness();
    const ada = h.users.attendeeAda;
    const first = await checkIn(h.ctx, { eventId: h.eventId, userId: ada, spaceId: 'sp-atrium' });
    h.setNow(h.now() + 10 * 60 * 1000);
    const second = await checkIn(h.ctx, { eventId: h.eventId, userId: ada, spaceId: 'sp-main' });
    const visits = (await listMyPlaces(h.ctx, h.eventId, ada)).visits;
    expect(visits.find((v) => v.id === first.id)?.departedAt).toBe(first.arrivedAt + 10 * 60 * 1000);
    expect(visits.find((v) => v.id === second.id)?.departedAt).toBeNull();
  });

  it('refuses a check-in to a space that is not on the venue map', async () => {
    const h = await createHarness();
    await expectDomainError(checkIn(h.ctx, { eventId: h.eventId, userId: h.users.attendeeAda, spaceId: 'sp-nowhere' }), 'VALIDATION_FAILED');
  });

  it('lets the person correct the times, and refuses an end before the start or a time in the future', async () => {
    const h = await createHarness();
    const ada = h.users.attendeeAda;
    const visit = await checkIn(h.ctx, { eventId: h.eventId, userId: ada, spaceId: 'sp-atrium' });
    const ended = await endVisit(h.ctx, { eventId: h.eventId, userId: ada, visitId: visit.id, expectedVersion: visit.version });
    const corrected = await correctVisit(h.ctx, {
      eventId: h.eventId,
      userId: ada,
      visitId: visit.id,
      expectedVersion: ended.version,
      arrivedAt: visit.arrivedAt - 5 * 60 * 1000,
      departedAt: visit.arrivedAt,
    });
    expect(corrected.correctedAt).not.toBeNull();
    await expectDomainError(
      correctVisit(h.ctx, { eventId: h.eventId, userId: ada, visitId: visit.id, expectedVersion: corrected.version, arrivedAt: visit.arrivedAt, departedAt: visit.arrivedAt - 1 }),
      'VALIDATION_FAILED',
    );
    await expectDomainError(
      correctVisit(h.ctx, { eventId: h.eventId, userId: ada, visitId: visit.id, expectedVersion: corrected.version, arrivedAt: h.now() + 60 * 60 * 1000, departedAt: null }),
      'VALIDATION_FAILED',
    );
  });

  it('keeps another person’s visit out of reach, and deletes the owner’s', async () => {
    const h = await createHarness();
    const visit = await checkIn(h.ctx, { eventId: h.eventId, userId: h.users.attendeeAda, spaceId: 'sp-atrium' });
    await expectDomainError(deleteVisit(h.ctx, { eventId: h.eventId, userId: h.users.attendeeBen, visitId: visit.id }), 'NOT_FOUND');
    await deleteVisit(h.ctx, { eventId: h.eventId, userId: h.users.attendeeAda, visitId: visit.id });
    expect((await listMyPlaces(h.ctx, h.eventId, h.users.attendeeAda)).visits).toHaveLength(0);
  });
});

describe('Device keys', () => {
  it('retires the oldest device key when a ninth device publishes, so the new device always works', async () => {
    const h = await createHarness();
    const ada = h.users.attendeeAda;
    const published: string[] = [];
    for (let i = 0; i < 9; i += 1) {
      const { publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
      const jwk = publicKey.export({ format: 'jwk' }) as { x: string; y: string };
      const bundle = await publishKey(h.ctx, ada, { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y });
      published.push(bundle.id);
      h.setNow(h.now() + 1000);
    }
    const remaining = (await h.store.listKeyBundles(ada)).map((k) => k.id);
    expect(remaining).toHaveLength(8);
    expect(remaining).not.toContain(published[0]);
    expect(remaining).toContain(published[8]);
  });
});
