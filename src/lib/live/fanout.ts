import type { PostgresHelloStore } from '@/store/postgres';
import { EVERYONE, type LiveBus, type LiveEvent } from './bus';
import type { PresenceRegistry } from './presence';

/**
 * Live events across app instances, through Postgres LISTEN/NOTIFY.
 *
 * Every instance listens on one channel per store schema. An instance publishes its own change events
 * there, and receives the others'. It also reports who is online through it: at once when someone comes
 * online or leaves, and every PRESENCE_EVERY_MS as a heartbeat, so a crashed instance's people drop off.
 *
 * NOTIFY payloads must stay under 8,000 bytes. Change events are small (a nudge, never content), and
 * presence reports are split into chunks of PRESENCE_CHUNK people.
 */
export const PRESENCE_EVERY_MS = 10_000;
export const PRESENCE_CHUNK = 200;

type Wire = { k: 'e'; e: LiveEvent } | { k: 'p'; i: string; ev: string; at: number; u: string[] };

export interface Fanout {
  /** Tells other instances who is online here in one event, now. */
  reportPresence(eventId: string): void;
  stop(): Promise<void>;
}

export function channelFor(schema: string): string {
  return `hello_live_${schema}`;
}

export async function startFanout(store: PostgresHelloStore, bus: LiveBus, presence: PresenceRegistry): Promise<Fanout> {
  const channel = channelFor(store.schema);
  const send = (wire: Wire) => {
    store.notify(channel, JSON.stringify(wire)).catch(() => undefined);
  };

  bus.attachRemote({ send: (e) => { send({ k: 'e', e }); } });

  const stopListening = await store.listen(channel, (payload) => {
    let wire: Wire;
    try {
      wire = JSON.parse(payload) as Wire;
    } catch {
      return;
    }
    if (wire.k === 'e') {
      bus.receiveRemote(wire.e);
      return;
    }
    if (wire.i === bus.instanceId) return;
    // Another instance's people changed: pages here re-read who is online.
    if (presence.applyRemote(wire.i, wire.ev, wire.at, wire.u)) {
      bus.receiveRemote({ eventId: wire.ev, topic: 'presence', audience: EVERYONE, at: wire.at, origin: wire.i });
    }
  });

  const report = (eventId: string, users: string[]) => {
    const at = Date.now();
    if (users.length === 0) {
      send({ k: 'p', i: bus.instanceId, ev: eventId, at, u: [] });
      return;
    }
    for (let i = 0; i < users.length; i += PRESENCE_CHUNK) send({ k: 'p', i: bus.instanceId, ev: eventId, at, u: users.slice(i, i + PRESENCE_CHUNK) });
  };

  const heartbeat = setInterval(() => {
    for (const [eventId, users] of presence.localSnapshot()) report(eventId, users);
  }, PRESENCE_EVERY_MS);
  heartbeat.unref();

  return {
    reportPresence(eventId) {
      report(eventId, presence.localSnapshot().get(eventId) ?? []);
    },
    async stop() {
      clearInterval(heartbeat);
      bus.attachRemote(null);
      await stopListening();
    },
  };
}
