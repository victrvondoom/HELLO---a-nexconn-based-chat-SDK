import { describe, expect, it } from 'vitest';
import { createHarness, STORE_KIND } from './harness';
import { samePayload } from '@/services/approvals';
import { VersionConflictError } from '@/store/store';
import type { Notification } from '@/domain/types';

/**
 * The guarantees every HelloStore must keep, checked against whichever store the suite runs on
 * (`npm test`: memory; `npm run test:postgres`: a real Postgres database). They are the guarantees the
 * services rely on for correctness under concurrent requests.
 */
describe(`store contract (${STORE_KIND})`, () => {
  it('serialises concurrent read-modify-writes: no update is lost', async () => {
    const h = await createHarness();
    await h.store.docPut('prefs', { id: 'counter', country: '0' });
    await Promise.all(
      Array.from({ length: 25 }, () => h.store.docMutate('prefs', 'counter', (doc) => ({ ...doc, country: String(Number(doc.country) + 1) }))),
    );
    expect((await h.store.docGet('prefs', 'counter'))?.country).toBe('25');
  });

  it('lets exactly one concurrent insert-if-absent win', async () => {
    const h = await createHarness();
    const results = await Promise.all(Array.from({ length: 10 }, (_, i) => h.store.docPutIfAbsent('prefs', { id: 'once', country: String(i) })));
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it('accepts exactly one of several updates made against the same version', async () => {
    const h = await createHarness();
    const incident = await h.store.getIncident('inc-seed-av-r3');
    if (!incident) throw new Error('seed incident missing');
    const attempts = await Promise.allSettled(Array.from({ length: 6 }, (_, i) => h.store.updateIncident(incident.id, incident.version, { title: `Edit ${i}` }, h.now())));
    expect(attempts.filter((a) => a.status === 'fulfilled')).toHaveLength(1);
    const rejected = attempts.filter((a): a is PromiseRejectedResult => a.status === 'rejected');
    expect(rejected.every((a) => a.reason instanceof VersionConflictError)).toBe(true);
    expect((await h.store.getIncident(incident.id))?.version).toBe(incident.version + 1);
  });

  it('writes a notification once per dedupe key, even when sent at the same moment', async () => {
    const h = await createHarness();
    const base: Notification = { id: 'ntf-x', eventId: h.eventId, recipientUserId: h.users.attendeeAda, kind: 'TEST', body: 'Hello', href: '/', dedupeKey: 'TEST|once', createdAt: h.now(), readAt: null };
    const results = await Promise.all(Array.from({ length: 8 }, (_, i) => h.store.insertNotificationIfNew({ ...base, id: `ntf-x${i}` })));
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it('returns records exactly as written, and keeps insertion order in lists', async () => {
    const h = await createHarness();
    const docs = ['c', 'a', 'b'].map((id) => ({ id: `pst-${id}`, eventId: h.eventId, authorId: h.users.attendeeAda, communityId: null, text: `post ${id}`, mediaId: null, mediaKind: null, repostOf: null, backdrop: null, likes: [], createdAt: 1 }));
    for (const d of docs) await h.store.docPut('posts', d);
    expect((await h.store.docList('posts', { authorId: h.users.attendeeAda })).map((p) => p.id)).toEqual(['pst-c', 'pst-a', 'pst-b']);
    expect(await h.store.docGet('posts', 'pst-a')).toEqual(docs[1]);
    // Matching on a null field finds the documents where the field is null.
    expect((await h.store.docList('posts', { communityId: null, text: 'post b' })).map((p) => p.id)).toEqual(['pst-b']);
  });

  it('compares approval payloads by content, not key order', () => {
    expect(samePayload({ sessionId: 's1', toRoomId: 'r2' }, { toRoomId: 'r2', sessionId: 's1' })).toBe(true);
    expect(samePayload({ sessionId: 's1', toRoomId: 'r2' }, { sessionId: 's1', toRoomId: 'r3' })).toBe(false);
    expect(samePayload({ sessionId: 's1' }, { sessionId: 's1', toRoomId: 'r3' })).toBe(false);
  });

  it('keeps media bytes intact', async () => {
    const h = await createHarness();
    const bytes = new Uint8Array([0, 1, 2, 250, 255, 128]);
    await h.store.blobPut('med_bytes', bytes);
    expect(Array.from((await h.store.blobGet('med_bytes')) ?? [])).toEqual(Array.from(bytes));
    await h.store.blobDelete('med_bytes');
    expect(await h.store.blobGet('med_bytes')).toBeNull();
  });
});
