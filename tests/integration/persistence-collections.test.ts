import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHarness, STORE_KIND } from './harness';
import { DomainError } from '@/domain/errors';
import type { ApprovalRequest } from '@/domain/types';
import type { LiveReport, PlaceCollection, PlaceImport, PlaceVisit, SafetyHold, SavedPlace } from '@/domain/product';
import { persistenceFromEnv } from '@/lib/persistence';
import { MemoryHelloStore } from '@/store/memory';
import { PostgresHelloStore, StoreUnavailableError } from '@/store/postgres';
import { VersionConflictError } from '@/store/store';
import { createPlace, listMyPlaces, updatePlace, deletePlace, createCollection } from '@/services/places';
import { checkIn, correctVisit, deleteVisit, endVisit } from '@/services/place-visits';
import { placeSafetyHold, releaseSafetyHold, submitLiveReport } from '@/services/live';
import { eraseMe } from '@/services/rights';

/**
 * Persistence of the six collections that carry the Living Atlas and LiveScene records: places, placeVisits,
 * placeImports, liveReports, safetyHolds, placeCollections. All of them live in the generic document table, so
 * the checks go through the `HelloStore` contract and through the services that own the rules.
 *
 * On `npm test` the in-memory store runs them. With HELLO_TEST_DATABASE_URL set (`npm run test:postgres`) every
 * harness gets its own Postgres schema, so the same assertions run against a real database. The tests marked
 * Postgres-only need that database and are skipped, visibly, without it.
 */

const NOW = 1_795_000_000_000; // above 2^31, so a 32-bit slip in a column or a cast would show.
const ADA = 'u-att-ada';
const BEN = 'u-att-ben';
const EVENT = 'evt-demo';

const place = (over: Partial<SavedPlace> = {}): SavedPlace => ({
  id: 'plc-1', eventId: EVENT, ownerId: ADA, name: 'Café “Água” 🌊', description: '', category: 'COFFEE', spaceId: null,
  latitude: null, longitude: null, address: null, status: 'SAVED', favourite: false, rating: null, privateNoteSealed: 'sealed-bytes',
  collectionIds: [], tags: ['a'], source: { type: 'MANUAL', reference: null }, visibility: 'PRIVATE', createdAt: NOW, updatedAt: NOW, updates: 0, version: 1, ...over,
});
const collection = (over: Partial<PlaceCollection> = {}): PlaceCollection => ({ id: 'plcol-1', eventId: EVENT, ownerId: ADA, name: 'Quiet spots', createdAt: NOW, version: 1, ...over });
const visit = (over: Partial<PlaceVisit> = {}): PlaceVisit => ({ id: 'plvisit-1', eventId: EVENT, ownerId: ADA, spaceId: 'sp-atrium', placeId: null, arrivedAt: NOW, departedAt: null, method: 'CHECK_IN', correctedAt: null, version: 1, ...over });
const importRecord = (over: Partial<PlaceImport> = {}): PlaceImport => ({ id: 'plimp-1', eventId: EVENT, ownerId: ADA, fileName: 'x.csv', format: 'CSV', total: 3, saved: 1, skipped: 2, failures: [{ line: 2, reason: 'No name' }], createdAt: NOW, version: 1, ...over });
const report = (over: Partial<LiveReport> = {}): LiveReport => ({
  id: 'lrp-1', eventId: EVENT, reporterUserId: ADA, category: 'CROWD', spaceId: 'sp-atrium', zone: 'Atrium', text: 'Packed', safetySignal: null,
  status: 'OPEN', incidentId: null, createdAt: NOW, expiresAt: NOW + 60_000, decisionByUserId: null, decidedAt: null, decisionReason: null, version: 1, ...over,
});
const hold = (over: Partial<SafetyHold> = {}): SafetyHold => ({
  id: 'hold-1', eventId: EVENT, scope: { kind: 'ZONE', zone: 'Main' }, reason: 'Investigating', placedByUserId: 'u-ops-lena', placedAt: NOW, decisionDueAt: NOW + 900_000,
  status: 'IN_FORCE', releasedByUserId: null, releasedAt: null, releaseReason: null, version: 1, ...over,
});

describe(`six collections: store contract (${STORE_KIND})`, () => {
  // Each row: the collection, a record with nullable fields left null, and a field to change.
  const cases = [
    { name: 'places', make: place, owner: 'ownerId', change: (d: SavedPlace) => ({ ...d, rating: 5, version: d.version + 1 }) },
    { name: 'placeCollections', make: collection, owner: 'ownerId', change: (d: PlaceCollection) => ({ ...d, name: 'Renamed', version: d.version + 1 }) },
    { name: 'placeVisits', make: visit, owner: 'ownerId', change: (d: PlaceVisit) => ({ ...d, departedAt: NOW + 5, version: d.version + 1 }) },
    { name: 'placeImports', make: importRecord, owner: 'ownerId', change: (d: PlaceImport) => ({ ...d, saved: 2, version: d.version + 1 }) },
    { name: 'liveReports', make: report, owner: 'reporterUserId', change: (d: LiveReport) => ({ ...d, status: 'DISMISSED' as const, version: d.version + 1 }) },
    { name: 'safetyHolds', make: hold, owner: 'placedByUserId', change: (d: SafetyHold) => ({ ...d, status: 'RELEASED' as const, version: d.version + 1 }) },
  ] as const;

  type LooseStore = {
    docPut: (n: string, d: unknown) => Promise<void>;
    docGet: (n: string, id: string) => Promise<{ id: string; version: number } | null>;
    docList: (n: string, w?: Record<string, unknown>) => Promise<Array<{ id: string; version: number }>>;
    docMutate: (n: string, id: string, f: (d: never) => unknown) => Promise<unknown>;
    docDelete: (n: string, id: string) => Promise<boolean>;
    docPutIfAbsent: (n: string, d: unknown) => Promise<boolean>;
  };

  for (const c of cases) {
    it(`${c.name}: stores, reads back unchanged, updates, lists in order, scopes by event, deletes`, async () => {
      const h = await createHarness();
      const store = h.store as unknown as LooseStore;
      const make = c.make as (over?: Record<string, unknown>) => { id: string };
      const first = make({ id: 'a-1' });
      expect(await store.docGet(c.name, 'a-1')).toBeNull();
      await store.docPut(c.name, first);
      // Every field, including nulls, large timestamps, unicode and nested arrays, comes back as written.
      expect(await store.docGet(c.name, 'a-1')).toEqual(first);

      await store.docPut(c.name, make({ id: 'a-3' }));
      await store.docPut(c.name, make({ id: 'a-2' }));
      await store.docPut(c.name, make({ id: 'other-event', eventId: 'evt-other' }));
      expect((await store.docList(c.name, { eventId: EVENT })).map((d) => d.id)).toEqual(['a-1', 'a-3', 'a-2']);
      expect((await store.docList(c.name, { eventId: 'evt-other' })).map((d) => d.id)).toEqual(['other-event']);
      expect(await store.docList(c.name, { eventId: 'evt-nobody' })).toEqual([]);

      // An update changes the record and keeps its place in the list.
      const changed = await store.docMutate(c.name, 'a-3', c.change);
      expect((changed as { version: number }).version).toBe(2);
      expect((await store.docGet(c.name, 'a-3'))?.version).toBe(2);
      expect((await store.docList(c.name, { eventId: EVENT })).map((d) => d.id)).toEqual(['a-1', 'a-3', 'a-2']);
      // The other records were not touched.
      expect(await store.docGet(c.name, 'a-1')).toEqual(first);

      // Missing records: a read gives null, a mutate gives null and creates nothing.
      expect(await store.docGet(c.name, 'missing')).toBeNull();
      expect(await store.docMutate(c.name, 'missing', c.change)).toBeNull();
      expect(await store.docGet(c.name, 'missing')).toBeNull();
      // A mutate that declines leaves the record as it was.
      expect(await store.docMutate(c.name, 'a-1', () => null)).toBeNull();
      expect(await store.docGet(c.name, 'a-1')).toEqual(first);

      // Insert-if-absent never overwrites.
      expect(await store.docPutIfAbsent(c.name, make({ id: 'a-1', eventId: 'evt-hijack' }))).toBe(false);
      expect(await store.docGet(c.name, 'a-1')).toEqual(first);

      // Delete reports whether anything was deleted, and the other records stay.
      expect(await store.docDelete(c.name, 'a-1')).toBe(true);
      expect(await store.docDelete(c.name, 'a-1')).toBe(false);
      expect(await store.docGet(c.name, 'a-1')).toBeNull();
      expect((await store.docList(c.name, { eventId: EVENT })).map((d) => d.id)).toEqual(['a-3', 'a-2']);
      // Same id in another collection is a different record.
      expect(await store.docGet('prefs', 'a-3')).toBeNull();
    });

    it(`${c.name}: a query value is data, never SQL`, async () => {
      const h = await createHarness();
      const store = h.store as unknown as LooseStore;
      await store.docPut(c.name, (c.make as (o?: Record<string, unknown>) => unknown)({ id: 'safe-1' }));
      expect(await store.docList(c.name, { [c.owner]: "x'; drop table hello_documents; --" })).toEqual([]);
      expect(await store.docList(c.name, { eventId: EVENT })).toHaveLength(1);
    });
  }

  it('lets exactly one of several writers holding the same version win, on every versioned collection', async () => {
    const h = await createHarness();
    await h.store.docPut('places', place({ id: 'race-p' }));
    await h.store.docPut('placeVisits', visit({ id: 'race-v' }));
    await h.store.docPut('safetyHolds', hold({ id: 'race-h' }));
    const guarded = async (name: 'places' | 'placeVisits' | 'safetyHolds', id: string) => {
      const results = await Promise.all(
        Array.from({ length: 12 }, () => h.store.docMutate(name, id, (doc) => (doc.version === 1 ? { ...doc, version: 2 } : null))),
      );
      expect(results.filter((r) => r !== null)).toHaveLength(1);
      expect((await h.store.docGet(name, id))?.version).toBe(2);
    };
    await guarded('places', 'race-p');
    await guarded('placeVisits', 'race-v');
    await guarded('safetyHolds', 'race-h');
  });

  it('keeps every increment when many unguarded updates run at once', async () => {
    const h = await createHarness();
    await h.store.docPut('placeImports', importRecord({ id: 'count', saved: 0 }));
    await Promise.all(Array.from({ length: 30 }, () => h.store.docMutate('placeImports', 'count', (d) => ({ ...d, saved: d.saved + 1 }))));
    expect((await h.store.docGet('placeImports', 'count'))?.saved).toBe(30);
  });

  it('rejects a stale approval update instead of overwriting', async () => {
    const h = await createHarness();
    const approval: ApprovalRequest = {
      id: 'apr-race', eventId: h.eventId, actionType: 'PUBLISH_ANNOUNCEMENT', payload: { a: '1' }, justification: 'Testing the race', requestedByUserId: h.users.opsLena,
      status: 'PENDING', expiresAt: h.now() + 60_000, decidedByUserId: null, decidedAt: null, decisionReason: null, executionStatus: 'NOT_STARTED',
      executionResult: null, executedAt: null, linkedIncidentId: null, version: 1,
    };
    await h.store.insertApproval(approval);
    const attempts = await Promise.allSettled(Array.from({ length: 6 }, (_, i) => h.store.updateApproval('apr-race', 1, { decisionReason: `try ${i}` })));
    expect(attempts.filter((a) => a.status === 'fulfilled')).toHaveLength(1);
    expect(attempts.filter((a): a is PromiseRejectedResult => a.status === 'rejected').every((a) => a.reason instanceof VersionConflictError)).toBe(true);
    expect((await h.store.getApproval('apr-race'))?.version).toBe(2);
    await expect(h.store.updateApproval('apr-race', 1, { decisionReason: 'late' })).rejects.toBeInstanceOf(VersionConflictError);
    await expect(h.store.updateApproval('apr-missing', 1, {})).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe(`six collections: services keep their rules (${STORE_KIND})`, () => {
  it('a stale place edit is refused and the newer value survives', async () => {
    const h = await createHarness();
    const created = await createPlace(h.ctx, h.eventId, ADA, { name: 'Noodles', category: 'FOOD', privateNote: 'first' });
    const results = await Promise.allSettled(
      ['one', 'two', 'three', 'four'].map((note) => updatePlace(h.ctx, { eventId: h.eventId, userId: ADA, placeId: created.id, expectedVersion: created.version, patch: { privateNote: note } })),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r): r is PromiseRejectedResult => r.status === 'rejected').every((r) => r.reason instanceof VersionConflictError)).toBe(true);
    const winner = (results.find((r) => r.status === 'fulfilled') as PromiseFulfilledResult<{ privateNote: string }>).value.privateNote;
    const [stored] = (await listMyPlaces(h.ctx, h.eventId, ADA)).places;
    expect(stored?.privateNote).toBe(winner);
    expect(stored?.version).toBe(created.version + 1);
    expect(stored?.updates).toBe(1);
  });

  it('visits: competing end and correct from one version let only one through', async () => {
    const h = await createHarness();
    const v = await checkIn(h.ctx, { eventId: h.eventId, userId: ADA, spaceId: 'sp-atrium' });
    const results = await Promise.allSettled([
      endVisit(h.ctx, { eventId: h.eventId, userId: ADA, visitId: v.id, expectedVersion: v.version }),
      correctVisit(h.ctx, { eventId: h.eventId, userId: ADA, visitId: v.id, expectedVersion: v.version, arrivedAt: v.arrivedAt, departedAt: v.arrivedAt + 1000 }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect((await h.store.docGet('placeVisits', v.id))?.version).toBe(v.version + 1);
  });

  it('safety holds: two staff placing the same scope make one hold; two organisers releasing it release it once', async () => {
    const h = await createHarness();
    const placed = await Promise.all([
      placeSafetyHold(h.ctx, { eventId: h.eventId, actorUserId: h.users.opsLena, scope: { kind: 'ZONE', zone: 'Main' }, reason: 'Crowd pressure at the hall', durationMinutes: 15 }),
      placeSafetyHold(h.ctx, { eventId: h.eventId, actorUserId: h.users.opsKiri, scope: { kind: 'ZONE', zone: 'Main' }, reason: 'Crowd pressure at the hall', durationMinutes: 15 }),
    ]);
    expect(placed.filter((p) => p.created)).toHaveLength(1);
    expect(await h.store.docList('safetyHolds', { eventId: h.eventId })).toHaveLength(1);
    const holdId = placed[0].hold.id;

    // Two other organisers racing: the hold is released once, the loser is told it was already handled.
    const released = await Promise.allSettled([
      releaseSafetyHold(h.ctx, { eventId: h.eventId, actorUserId: h.users.organiserNadia, holdId, reason: 'Checked with the venue team' }),
      releaseSafetyHold(h.ctx, { eventId: h.eventId, actorUserId: h.users.organiserOwen, holdId, reason: 'Checked with the venue team' }),
    ]);
    expect(released.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = released.find((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(rejected?.reason).toMatchObject({ code: 'ALREADY_HANDLED' });
    const stored = await h.store.docGet('safetyHolds', holdId);
    expect(stored?.status).toBe('RELEASED');
    expect(stored?.version).toBe(2);
  });

  it('owner isolation: another attendee cannot read, change, delete or attach to a private place, visit or collection', async () => {
    const h = await createHarness();
    const mine = await createPlace(h.ctx, h.eventId, ADA, { name: 'Ada only', category: 'OTHER', privateNote: 'secret' });
    const col = await createCollection(h.ctx, h.eventId, ADA, 'Ada list');
    const v = await checkIn(h.ctx, { eventId: h.eventId, userId: ADA, spaceId: 'sp-atrium', placeId: mine.id });

    const notFound = async (p: Promise<unknown>): Promise<void> => {
      expect(await p.then(() => null, (e: unknown) => e)).toMatchObject({ code: 'NOT_FOUND' });
    };
    await notFound(updatePlace(h.ctx, { eventId: h.eventId, userId: BEN, placeId: mine.id, expectedVersion: 1, patch: { name: 'Stolen' } }));
    await notFound(deletePlace(h.ctx, { eventId: h.eventId, userId: BEN, placeId: mine.id }));
    await notFound(checkIn(h.ctx, { eventId: h.eventId, userId: BEN, spaceId: 'sp-atrium', placeId: mine.id }));
    await notFound(endVisit(h.ctx, { eventId: h.eventId, userId: BEN, visitId: v.id, expectedVersion: 1 }));
    await notFound(deleteVisit(h.ctx, { eventId: h.eventId, userId: BEN, visitId: v.id }));
    await expect(createPlace(h.ctx, h.eventId, BEN, { name: 'Uses her list', category: 'OTHER', collectionIds: [col.id] })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });

    const bens = await listMyPlaces(h.ctx, h.eventId, BEN);
    expect([bens.places, bens.collections, bens.visits, bens.imports].map((l) => l.length)).toEqual([0, 0, 0, 0]);
    // Nothing of Ada's changed.
    expect((await h.store.docGet('places', mine.id))?.name).toBe('Ada only');
    expect((await h.store.docGet('places', mine.id))?.version).toBe(1);
    expect(await h.store.docGet('placeVisits', v.id)).toMatchObject({ departedAt: null, version: 1 });
  });

  it('event scope: nobody reaches places through an event they do not belong to', async () => {
    const h = await createHarness();
    const mine = await createPlace(h.ctx, h.eventId, ADA, { name: 'Scoped', category: 'OTHER' });
    await expect(listMyPlaces(h.ctx, 'evt-not-mine', ADA)).rejects.toBeInstanceOf(DomainError);
    await expect(updatePlace(h.ctx, { eventId: 'evt-not-mine', userId: ADA, placeId: mine.id, expectedVersion: 1, patch: { name: 'x' } })).rejects.toBeInstanceOf(DomainError);
    await expect(deletePlace(h.ctx, { eventId: 'evt-not-mine', userId: ADA, placeId: mine.id })).rejects.toBeInstanceOf(DomainError);
    expect(await h.store.docGet('places', mine.id)).not.toBeNull();
  });

  it('safety rules hold through the store: an attendee cannot place a hold, and a report stays under its reporter', async () => {
    const h = await createHarness();
    await expect(placeSafetyHold(h.ctx, { eventId: h.eventId, actorUserId: ADA, scope: { kind: 'ZONE', zone: 'Main' }, reason: 'Trying', durationMinutes: 15 })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(await h.store.docList('safetyHolds', { eventId: h.eventId })).toEqual([]);
    const { report: made } = await submitLiveReport(h.ctx, { eventId: h.eventId, userId: ADA, spaceId: 'sp-atrium', category: 'CROWD', text: 'Packed at the doors' });
    const stored = await h.store.docGet('liveReports', made.id);
    expect(stored).toEqual(made);
    expect(stored?.reporterUserId).toBe(ADA);
  });

  it('erasure removes the person’s records in all four place collections and nobody else’s', async () => {
    const h = await createHarness();
    await createPlace(h.ctx, h.eventId, ADA, { name: 'Ada place', category: 'OTHER' });
    await createCollection(h.ctx, h.eventId, ADA, 'Ada list');
    await checkIn(h.ctx, { eventId: h.eventId, userId: ADA, spaceId: 'sp-atrium' });
    await h.store.docPut('placeImports', importRecord({ id: 'imp-ada' }));
    await createPlace(h.ctx, h.eventId, BEN, { name: 'Ben place', category: 'OTHER' });
    await eraseMe(h.ctx, ADA);
    for (const name of ['places', 'placeCollections', 'placeVisits', 'placeImports'] as const) {
      expect(await h.store.docList(name, { ownerId: ADA })).toEqual([]);
    }
    expect(await h.store.docList('places', { ownerId: BEN })).toHaveLength(1);
  });
});

describe('disk persistence (HELLO_DATA_DIR) of the six collections', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it('survives a restart: a new store restored from the saved file holds the same records', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hello-persist-'));
    dirs.push(dir);
    const disk = persistenceFromEnv({ HELLO_DATA_DIR: dir });
    if (!disk) throw new Error('persistence was not enabled');
    const first = new MemoryHelloStore();
    const attached = disk.attach(first, () => NOW);
    await attached.docPut('places', place());
    await attached.docPut('placeCollections', collection());
    await attached.docPut('placeVisits', visit());
    await attached.docPut('placeImports', importRecord());
    await attached.docPut('liveReports', report());
    await attached.docPut('safetyHolds', hold());
    disk.flush();

    const second = new MemoryHelloStore();
    expect(persistenceFromEnv({ HELLO_DATA_DIR: dir })?.restore(second)).toBe(NOW);
    expect(await second.docGet('places', 'plc-1')).toEqual(place());
    expect(await second.docGet('placeCollections', 'plcol-1')).toEqual(collection());
    expect(await second.docGet('placeVisits', 'plvisit-1')).toEqual(visit());
    expect(await second.docGet('placeImports', 'plimp-1')).toEqual(importRecord());
    expect(await second.docGet('liveReports', 'lrp-1')).toEqual(report());
    expect(await second.docGet('safetyHolds', 'hold-1')).toEqual(hold());
  });
});

describe('Postgres unavailable: no fallback, no leaked details', () => {
  const SECRET = 'S3cretPassw0rd';
  const URL = `postgres://hello_user:${SECRET}@127.0.0.1:1/hello_private_db`;

  afterEach(() => {
    delete (globalThis as { __helloRuntime?: unknown }).__helloRuntime;
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('connect fails with a fixed message that carries no credentials, host or database name', async () => {
    const error = await PostgresHelloStore.connect({ connectionString: URL, schema: 'unreachable', max: 1 }).then(() => null, (e: unknown) => e);
    expect(error).toBeInstanceOf(StoreUnavailableError);
    const text = `${(error as Error).message} ${JSON.stringify(error)} ${((error as Error).stack ?? '').split('\n')[0]}`;
    for (const secret of [SECRET, 'hello_user', '127.0.0.1', 'hello_private_db']) expect(text).not.toContain(secret);
    expect((error as StoreUnavailableError).reason).toMatch(/^[A-Z0-9_]+$/);
  });

  it('the runtime refuses to start on in-memory storage, logs only a reason code, and tries again on the next request', async () => {
    vi.stubEnv('DATABASE_URL', URL);
    vi.stubEnv('HELLO_DATA_DIR', '');
    const lines: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((line: unknown) => {
      lines.push(String(line));
    });
    vi.resetModules();
    const { getRuntime } = await import('@/lib/runtime');
    const first = getRuntime();
    await expect(first).rejects.toBeInstanceOf(Error);
    // Not remembered: the next call starts again instead of serving the failure forever, and still does not resolve to memory.
    const second = getRuntime();
    expect(second).not.toBe(first);
    await expect(second).rejects.toBeInstanceOf(Error);
    const logged = lines.join('\n');
    expect(logged).toContain('runtime_start_failed');
    for (const secret of [SECRET, 'hello_user', '127.0.0.1', 'hello_private_db']) expect(logged).not.toContain(secret);
  });

  it('an API caller sees a generic error, never the database error', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { errorResponse } = await import('@/lib/http');
    const response = errorResponse(new StoreUnavailableError({ code: 'ECONNREFUSED' }), '/api/test');
    expect(response.status).toBe(500);
    const body = JSON.stringify(await response.json());
    expect(body).toContain('INTERNAL');
    expect(body).not.toMatch(/postgres|ECONNREFUSED|database/i);
  });
});

describe.skipIf(STORE_KIND !== 'postgres')('Postgres only: durability across a reconnect', () => {
  const url = process.env.HELLO_TEST_DATABASE_URL ?? '';

  it('records written by one connection are read, unchanged and in order, by a new connection to the same schema', async () => {
    const schema = `t_dur_${process.pid}_${randomBytes(3).toString('hex')}`;
    const writer = await PostgresHelloStore.connect({ connectionString: url, schema, max: 2, idleTimeoutMillis: 250 });
    let reader: PostgresHelloStore | null = null;
    try {
      await writer.docPut('places', place({ id: 'p-b' }));
      await writer.docPut('places', place({ id: 'p-a' }));
      await writer.docPut('placeCollections', collection());
      await writer.docPut('placeVisits', visit());
      await writer.docPut('placeImports', importRecord());
      await writer.docPut('liveReports', report());
      await writer.docPut('safetyHolds', hold());
      await writer.docMutate('places', 'p-a', (d) => ({ ...d, rating: 4, version: 2 }));
      await writer.close(); // the "restart": every connection is gone

      reader = await PostgresHelloStore.connect({ connectionString: url, schema, max: 2, idleTimeoutMillis: 250 }); // re-applies the schema
      expect((await reader.docList('places', { eventId: EVENT })).map((p) => p.id)).toEqual(['p-b', 'p-a']);
      expect(await reader.docGet('places', 'p-a')).toEqual(place({ id: 'p-a', rating: 4, version: 2 }));
      expect(await reader.docGet('placeCollections', 'plcol-1')).toEqual(collection());
      expect(await reader.docGet('placeVisits', 'plvisit-1')).toEqual(visit());
      expect(await reader.docGet('placeImports', 'plimp-1')).toEqual(importRecord());
      expect(await reader.docGet('liveReports', 'lrp-1')).toEqual(report());
      expect(await reader.docGet('safetyHolds', 'hold-1')).toEqual(hold());
      // A second start did not wipe or duplicate anything.
      expect(await reader.docList('places')).toHaveLength(2);
      // And the version rule still works on the old data.
      const open = reader;
      const attempts = await Promise.all([1, 2, 3].map(() => open.docMutate('safetyHolds', 'hold-1', (d) => (d.version === 1 ? { ...d, status: 'RELEASED' as const, version: 2 } : null))));
      expect(attempts.filter((a) => a !== null)).toHaveLength(1);
    } finally {
      // Only this test's own generated schema is ever dropped, and close() refuses to drop `public`.
      await (reader ?? (await PostgresHelloStore.connect({ connectionString: url, schema, max: 1, idleTimeoutMillis: 250 }))).close({ dropSchema: true });
    }
  });

  it('two app instances sharing one schema serialise competing writes', async () => {
    const schema = `t_two_${process.pid}_${randomBytes(3).toString('hex')}`;
    const a = await PostgresHelloStore.connect({ connectionString: url, schema, max: 2, idleTimeoutMillis: 250 });
    const b = await PostgresHelloStore.connect({ connectionString: url, schema, max: 2, idleTimeoutMillis: 250 });
    try {
      await a.docPut('places', place({ id: 'shared' }));
      const results = await Promise.all(
        Array.from({ length: 10 }, (_, i) => (i % 2 ? a : b).docMutate('places', 'shared', (d) => (d.version === 1 ? { ...d, name: `by ${i}`, version: 2 } : null))),
      );
      expect(results.filter((r) => r !== null)).toHaveLength(1);
      expect((await a.docGet('places', 'shared'))?.version).toBe(2);
    } finally {
      await a.close();
      await b.close({ dropSchema: true });
    }
  });
});
