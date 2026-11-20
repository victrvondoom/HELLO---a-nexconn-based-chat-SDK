import { randomBytes } from 'node:crypto';
import { afterAll } from 'vitest';
import { createVault } from '@/lib/vault';
import { createContext, type ServiceContext } from '@/services/context';
import { MemoryHelloStore } from '@/store/memory';
import { PostgresHelloStore } from '@/store/postgres';
import type { SeedableStore } from '@/store/store';
import { DEMO_EVENT_ID, DEMO_NOW, DEMO_USERS, loadDemoEvent } from '@/store/seed';
import type { IntentProvider } from '@/ai/intent';
import type { WebSearchProvider } from '@/agents/web';
import type { Incident } from '@/domain/types';

/**
 * The store the integration suite runs against. With HELLO_TEST_DATABASE_URL set, every harness gets a
 * Postgres store in a schema of its own (created here, dropped after the file), so the whole suite runs
 * against a real database: `npm run test:postgres`. Otherwise the in-memory store is used.
 */
const DATABASE_URL = process.env.HELLO_TEST_DATABASE_URL ?? '';
export const STORE_KIND: 'memory' | 'postgres' = DATABASE_URL ? 'postgres' : 'memory';

const opened: PostgresHelloStore[] = [];
let schemaCounter = 0;

if (STORE_KIND === 'postgres') {
  afterAll(async () => {
    await Promise.all(opened.splice(0).map((s) => s.close({ dropSchema: true })));
  });
}

async function freshStore(): Promise<SeedableStore> {
  if (STORE_KIND === 'memory') return new MemoryHelloStore();
  schemaCounter += 1;
  const schema = `t_${process.pid}_${schemaCounter}_${randomBytes(3).toString('hex')}`;
  // Tests in a file run one after another, and a harness is not used after its test. A short idle timeout
  // means finished tests hold no connections, so parallel test files stay well under max_connections.
  const store = await PostgresHelloStore.connect({ connectionString: DATABASE_URL, schema, max: 3, idleTimeoutMillis: 250 });
  opened.push(store);
  return store;
}

/** A fresh demo store with a controllable clock and sequential IDs. */
export async function createHarness(options: { provider?: IntentProvider | null; webSearch?: WebSearchProvider | null } = {}) {
  const store = await freshStore();
  const vault = createVault(randomBytes(32));
  await loadDemoEvent(store, { vault });
  let clock = DEMO_NOW;
  let sequence = 0;
  const ctx: ServiceContext = createContext(store, {
    now: () => clock,
    newId: (prefix) => `${prefix}-${++sequence}`,
    intentProvider: options.provider ?? null,
    webSearch: options.webSearch ?? null,
    webSearchTimeoutMs: 200,
    vault,
  });
  return {
    store,
    ctx,
    eventId: DEMO_EVENT_ID,
    users: DEMO_USERS,
    now: () => clock,
    setNow(value: number) {
      clock = value;
    },
    async versionOf(incidentId: string): Promise<number> {
      const incident: Incident | null = await store.getIncident(incidentId);
      if (!incident) throw new Error(`missing incident ${incidentId}`);
      return incident.version;
    },
  };
}

export type Harness = Awaited<ReturnType<typeof createHarness>>;
