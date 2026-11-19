import { createContext, type ServiceContext } from '@/services/context';
import { MemoryHelloStore } from '@/store/memory';
import { PostgresHelloStore } from '@/store/postgres';
import type { HelloStore } from '@/store/store';
import { DEMO_NOW, loadDemoEvent } from '@/store/seed';
import { webSearchFromEnv } from '@/agents/web';
import { vaultFromEnv } from '@/lib/vault';
import { persistenceFromEnv, type Persistence } from '@/lib/persistence';
import { resetAllRateLimiters } from '@/lib/rate-limit';
import { logError } from '@/lib/logger';

/**
 * Process-wide runtime. The store is chosen from the environment:
 *
 * - DATABASE_URL set: Postgres (src/store/postgres.ts). Durable and safe for several app instances; the
 *   schema is created on first start. Rate limits and live updates are still per instance.
 * - HELLO_DATA_DIR set: the in-memory store, written to disk (single instance only).
 * - Neither: the in-memory store only. Everything is lost on restart.
 *
 * An empty store is seeded with the demo event, which is the event the app serves.
 *
 * The clock starts at the seeded event time and then advances in real time, so timers and "minutes ago"
 * labels move. It is saved with the data, so a restart continues from where it was. Tests use their own
 * fixed clock.
 */
export interface Runtime {
  store: HelloStore;
  ctx: ServiceContext;
  persistence: 'MEMORY_DEMO' | 'DISK' | 'POSTGRES';
  disk: Persistence | null;
  database: PostgresHelloStore | null;
  clock: 'LIVE_FROM_SEEDED_EVENT_TIME';
  /** Stops background work (the clock save). Called before the runtime is discarded. */
  stop: () => void;
}

type GlobalWithRuntime = typeof globalThis & { __helloRuntime?: Promise<Runtime> };
const g = globalThis as GlobalWithRuntime;

/** How often the Postgres runtime saves its clock. A restart resumes at least this far ahead, so time never runs backwards. */
const CLOCK_SAVE_MS = 5_000;

function contextFor(store: HelloStore, now: () => number, vault: ReturnType<typeof vaultFromEnv>): ServiceContext {
  return createContext(store, {
    now,
    newId: (prefix) => `${prefix}_${crypto.randomUUID().slice(0, 12)}`,
    intentProvider: null,
    // Read from HELLO_WEB_SEARCH_PROVIDER / HELLO_WEB_SEARCH_API_KEY. Null when not configured.
    webSearch: webSearchFromEnv(process.env),
    vault,
  });
}

async function createPostgresRuntime(connectionString: string, vault: ReturnType<typeof vaultFromEnv>): Promise<Runtime> {
  const schema = (process.env.HELLO_DB_SCHEMA ?? '').trim() || 'public';
  const database = await PostgresHelloStore.connect({ connectionString, schema });
  let savedNow = await database.getMeta<number>('clock');
  if (await database.isEmpty()) {
    await loadDemoEvent(database, { vault });
    savedNow = null;
  }
  const base = Math.max(DEMO_NOW, savedNow === null ? 0 : savedNow + CLOCK_SAVE_MS);
  const bootedAt = Date.now();
  const now = () => base + (Date.now() - bootedAt);
  await database.setMeta('clock', now());
  const timer = setInterval(() => {
    database.setMeta('clock', now()).catch((error: unknown) => {
      logError('clock_save_failed', { detail: error instanceof Error ? error.message : 'unknown' });
    });
  }, CLOCK_SAVE_MS);
  timer.unref();
  return {
    store: database,
    ctx: contextFor(database, now, vault),
    persistence: 'POSTGRES',
    disk: null,
    database,
    clock: 'LIVE_FROM_SEEDED_EVENT_TIME',
    stop: () => {
      clearInterval(timer);
    },
  };
}

async function createRuntime(): Promise<Runtime> {
  const vault = vaultFromEnv(process.env);
  const databaseUrl = (process.env.DATABASE_URL ?? '').trim();
  if (databaseUrl) return createPostgresRuntime(databaseUrl, vault);

  const memory = new MemoryHelloStore();
  const disk = persistenceFromEnv(process.env);
  // A saved store is restored as it was; otherwise the demo event is seeded.
  const savedNow = disk?.restore(memory) ?? null;
  if (savedNow === null) await loadDemoEvent(memory, { vault });
  const base = Math.max(DEMO_NOW, savedNow ?? 0);
  const bootedAt = Date.now();
  const now = () => base + (Date.now() - bootedAt);
  const store = disk ? disk.attach(memory, now) : memory;
  return { store, ctx: contextFor(store, now, vault), persistence: disk ? 'DISK' : 'MEMORY_DEMO', disk, database: null, clock: 'LIVE_FROM_SEEDED_EVENT_TIME', stop: () => undefined };
}

/** Returns the same runtime for the life of the process, including across dev hot-reloads. */
export function getRuntime(): Promise<Runtime> {
  g.__helloRuntime ??= createRuntime();
  return g.__helloRuntime;
}

/** Discards all state. The next request re-seeds the demo event. Used by demo reset only. */
export async function resetRuntime(): Promise<void> {
  resetAllRateLimiters();
  const current = await g.__helloRuntime?.catch(() => null);
  current?.stop();
  current?.disk?.wipe();
  if (current?.database) {
    await current.database.wipe();
    await current.database.close();
  }
  g.__helloRuntime = undefined;
}
