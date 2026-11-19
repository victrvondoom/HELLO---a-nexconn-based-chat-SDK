import { afterEach, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { createHarness, STORE_KIND } from './harness';
import { LiveBus, visibleTo, type LiveEvent, type LiveViewer } from '@/lib/live/bus';
import { withLiveEvents } from '@/lib/live/store';
import { PresenceRegistry } from '@/lib/live/presence';
import { startFanout } from '@/lib/live/fanout';
import { PostgresHelloStore } from '@/store/postgres';
import { handleMessage } from '@/services/pipeline';
import { createPost } from '@/services/feed';
import { follow } from '@/services/social';
import { presenceFor } from '@/services/presence';
import { resetAllRateLimiters } from '@/lib/rate-limit';

afterEach(() => {
  resetAllRateLimiters();
});

/** A harness whose store publishes live events, as the server's does. */
async function liveHarness() {
  const h = await createHarness();
  const events: LiveEvent[] = [];
  const store = withLiveEvents(h.store, (e) => events.push(e), h.now);
  return { ...h, ctx: { ...h.ctx, store }, events };
}

const seen = (events: LiveEvent[], viewer: LiveViewer) => events.filter((e) => visibleTo(e, viewer)).map((e) => e.topic);

describe('live events from real services', () => {
  it('an attendee report reaches the reporter and staff, never another attendee', async () => {
    const h = await liveHarness();
    await handleMessage(h.ctx, { eventId: h.eventId, userId: h.users.attendeeBen, text: 'The projector in Room 2 is broken' });
    const ben = { eventId: h.eventId, userId: h.users.attendeeBen, staff: false };
    const ada = { eventId: h.eventId, userId: h.users.attendeeAda, staff: false };
    const kiri = { eventId: h.eventId, userId: h.users.opsKiri, staff: true };
    expect(seen(h.events, ben)).toContain('incidents');
    expect(seen(h.events, kiri)).toEqual(expect.arrayContaining(['incidents', 'messages', 'notifications']));
    // Ada learns nothing private: not that Ben messaged HELLO, not the incident. She only gets the
    // content-free nudge that a room's public condition summary may have changed.
    expect(seen(h.events, ada).every((topic) => topic === 'conditions')).toBe(true);
    expect(seen(h.events, ada)).not.toContain('incidents');
    expect(seen(h.events, ada)).not.toContain('messages');
  });

  it('a post reaches everyone in the event, and no event carries its text', async () => {
    const h = await liveHarness();
    await createPost(h.ctx, h.eventId, h.users.attendeeAda, { text: 'Coffee is out in the atrium', mediaId: null, communityId: null, repostOf: null });
    const chloe = { eventId: h.eventId, userId: h.users.attendeeChloe, staff: false };
    expect(seen(h.events, chloe)).toContain('posts');
    expect(JSON.stringify(h.events)).not.toContain('Coffee');
  });
});

describe('presence', () => {
  it('names only mutual connections and gives everyone else as a hidden-below-three count', async () => {
    const h = await createHarness();
    const { attendeeAda: ada, attendeeBen: ben, attendeeChloe: chloe, speakerInes: ines } = h.users;
    // Ada and Ines follow each other in the demo. Ben follows Ada, one way only.
    const online = new Set([ines, ben, chloe]);
    const view = await presenceFor(h.ctx, h.eventId, ada, online);
    expect(view.connectionsOnline).toEqual([ines]);
    expect(view.peopleOnline).toBe(3);
    expect((await presenceFor(h.ctx, h.eventId, ada, new Set([ines, ben]))).peopleOnline).toBeNull();
    await follow(h.ctx, h.eventId, ada, ben);
    expect((await presenceFor(h.ctx, h.eventId, ada, online)).connectionsOnline).toEqual([ben, ines].sort());
  });
});

describe.skipIf(STORE_KIND !== 'postgres')('live events across app instances (Postgres LISTEN/NOTIFY)', () => {
  it('a change on one instance reaches the other, and so does presence', async () => {
    const url = process.env.HELLO_TEST_DATABASE_URL ?? '';
    const schema = `t_fanout_${randomBytes(3).toString('hex')}`;
    const a = await PostgresHelloStore.connect({ connectionString: url, schema, max: 2 });
    const b = await PostgresHelloStore.connect({ connectionString: url, schema, max: 2 });
    const busA = new LiveBus();
    const busB = new LiveBus();
    const presenceA = new PresenceRegistry();
    const presenceB = new PresenceRegistry();
    const fanA = await startFanout(a, busA, presenceA);
    const fanB = await startFanout(b, busB, presenceB);
    try {
      const received = new Promise<LiveEvent>((resolve) => {
        busB.subscribe((e) => {
          if (e.topic === 'posts') resolve(e);
        });
      });
      busA.publish({ eventId: 'evt-x', topic: 'posts', audience: { kind: 'EVENT' }, at: 1 });
      const event = await Promise.race([received, new Promise<null>((r) => {
        setTimeout(() => {
          r(null);
        }, 3000);
      })]);
      expect(event?.topic).toBe('posts');

      presenceA.join('evt-x', 'u-ada');
      fanA.reportPresence('evt-x');
      const deadline = Date.now() + 3000;
      while (!presenceB.online('evt-x', Date.now()).has('u-ada') && Date.now() < deadline) await new Promise((r) => {
        setTimeout(r, 50);
      });
      expect(presenceB.online('evt-x', Date.now()).has('u-ada')).toBe(true);
    } finally {
      await fanA.stop();
      await fanB.stop();
      await a.close({ dropSchema: true });
      await b.close();
    }
  });
});
