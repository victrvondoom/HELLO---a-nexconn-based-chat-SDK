import { createContext, type ServiceContext } from '@/services/context';
import { MemoryHelloStore } from '@/store/memory';
import { DEMO_NOW, loadDemoEvent } from '@/store/seed';
import { webSearchFromEnv } from '@/agents/web';
import { vaultFromEnv } from '@/lib/vault';
import { persistenceFromEnv, type Persistence } from '@/lib/persistence';
import { resetAllRateLimiters } from '@/lib/rate-limit';

/**
 * Process-wide runtime. In this build the only persistence is the in-memory demo
 * store, seeded with clearly labelled demo data. Production deployments must
 * replace `createRuntime` with the Postgres-backed store (see docs/database.md).
 *
 * The clock is fixed to the seeded event time so the demo's relative timestamps
 * ("12 minutes ago") stay consistent. The UI shows this clock as demo-only.
 */
export interface Runtime {
  store: MemoryHelloStore;
  ctx: ServiceContext;
  persistence: 'MEMORY_DEMO' | 'DISK';
  disk: Persistence | null;
  clock: 'LIVE_FROM_SEEDED_EVENT_TIME';
}

type GlobalWithRuntime = typeof globalThis & { __helloRuntime?: Promise<Runtime> };
const g = globalThis as GlobalWithRuntime;

async function createRuntime(): Promise<Runtime> {
  const memory = new MemoryHelloStore();
  const vault = vaultFromEnv(process.env);
  const disk = persistenceFromEnv(process.env);
  // A saved store is restored as it was; otherwise the demo event is seeded.
  const savedNow = disk?.restore(memory) ?? null;
  if (savedNow === null) await loadDemoEvent(memory, { vault });
  const base = Math.max(DEMO_NOW, savedNow ?? 0);
  // The clock starts at the seeded event time and then advances in real time, so timers and
  // "minutes ago" labels move. Tests use their own fixed clock; the demo never does.
  const bootedAt = Date.now();
  const now = () => base + (Date.now() - bootedAt);
  const store = disk ? disk.attach(memory, now) : memory;
  const ctx = createContext(store, {
    now,
    newId: (prefix) => `${prefix}_${crypto.randomUUID().slice(0, 12)}`,
    intentProvider: null,
    // Read from HELLO_WEB_SEARCH_PROVIDER / HELLO_WEB_SEARCH_API_KEY. Null when not configured.
    webSearch: webSearchFromEnv(process.env),
    vault,
  });
  return { store, ctx, persistence: disk ? 'DISK' : 'MEMORY_DEMO', disk, clock: 'LIVE_FROM_SEEDED_EVENT_TIME' };
}

/** Returns the same runtime for the life of the process, including across dev hot-reloads. */
export function getRuntime(): Promise<Runtime> {
  g.__helloRuntime ??= createRuntime();
  return g.__helloRuntime;
}

/** Discards all in-memory state. The next request re-seeds the demo event. Used by demo reset only. */
export async function resetRuntime(): Promise<void> {
  resetAllRateLimiters();
  const current = await g.__helloRuntime?.catch(() => null);
  current?.disk?.wipe();
  g.__helloRuntime = undefined;
}
