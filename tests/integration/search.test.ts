import { describe, expect, it } from 'vitest';
import { createHarness } from './harness';
import { searchEvent } from '@/services/search';
import { handleMessage } from '@/services/pipeline';
import { normalise, queryTerms, scoreFields, snippet } from '@/domain/search';
import { DomainError } from '@/domain/errors';

describe('search scoring', () => {
  it('needs every term to match, prefers whole words, and ignores accents and case', () => {
    expect(queryTerms('  Inés  ROOM room ')).toEqual(['ines', 'room']);
    expect(normalise('Café–Bar')).toBe('cafe bar');
    const fields = [{ text: 'Edge Computing at Scale', weight: 3 }];
    expect(scoreFields(['edge'], fields)).toBe(3);
    expect(scoreFields(['comp'], fields)).toBeCloseTo(2.1);
    expect(scoreFields(['edge', 'robots'], fields)).toBeNull();
    expect(snippet('a '.repeat(200) + 'needle here', ['needle'], 40)).toContain('needle');
  });
});

describe('event search', () => {
  it('finds sessions, rooms and the event guide', async () => {
    const h = await createHarness();
    const r = await searchEvent(h.ctx, h.eventId, h.users.attendeeAda, 'edge computing');
    expect(r.hits[0]).toMatchObject({ kind: 'session', title: 'Edge Computing at Scale' });
    expect(r.hits[0]?.href).toMatch(/\/sessions\?current=/);
    expect((await searchEvent(h.ctx, h.eventId, h.users.attendeeAda, 'room 3')).hits.some((x) => x.kind === 'room' && x.href.endsWith('map?to=r-3'))).toBe(true);
  });

  it('never shows an attendee a request they did not report, but shows staff all of them', async () => {
    const h = await createHarness();
    // inc-seed-av-r3 ("Microphone fault in Room 3") was reported by Fatima.
    const ada = await searchEvent(h.ctx, h.eventId, h.users.attendeeAda, 'microphone');
    expect(ada.hits.some((x) => x.kind === 'request')).toBe(false);
    const fatima = await searchEvent(h.ctx, h.eventId, h.users.attendeeFatima, 'microphone');
    expect(fatima.hits.some((x) => x.kind === 'request')).toBe(true);
    const kiri = await searchEvent(h.ctx, h.eventId, h.users.opsKiri, 'microphone');
    expect(kiri.hits.some((x) => x.kind === 'request')).toBe(true);
  });

  it('finds only people who chose to be found', async () => {
    const h = await createHarness();
    const users = await h.store.listUsers();
    const hidden = users.find((u) => !u.discoverable && u.id !== h.users.attendeeChloe);
    const visible = users.find((u) => u.discoverable);
    if (!hidden || !visible) throw new Error('seed needs a discoverable and a hidden person');
    const followers = new Set((await h.store.listFollowers(h.users.attendeeChloe)).map((f) => f.followerId));
    const asChloe = (q: string) => searchEvent(h.ctx, h.eventId, h.users.attendeeChloe, q);
    expect((await asChloe(visible.displayName)).hits.some((x) => x.kind === 'person' && x.id === visible.id)).toBe(true);
    if (!followers.has(hidden.id)) {
      expect((await asChloe(hidden.displayName)).hits.some((x) => x.kind === 'person' && x.id === hidden.id)).toBe(false);
    }
  });

  it('counts only the viewer’s own messages to HELLO, never someone else’s', async () => {
    const h = await createHarness();
    await handleMessage(h.ctx, { eventId: h.eventId, userId: h.users.attendeeBen, text: 'The projector in Room 2 is broken' });
    expect((await searchEvent(h.ctx, h.eventId, h.users.attendeeAda, 'projector')).hits.some((x) => x.kind === 'messages')).toBe(false);
    const ben = await searchEvent(h.ctx, h.eventId, h.users.attendeeBen, 'projector');
    expect(ben.hits.find((x) => x.kind === 'messages')?.href).toMatch(/conversation\?q=projector/);
  });

  it('refuses a too-short query and a non-member', async () => {
    const h = await createHarness();
    await expect(searchEvent(h.ctx, h.eventId, h.users.attendeeAda, 'a')).rejects.toBeInstanceOf(DomainError);
    await expect(searchEvent(h.ctx, 'evt-other', h.users.attendeeAda, 'room')).rejects.toBeInstanceOf(DomainError);
  });
});
