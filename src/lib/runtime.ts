import { createContext, type ServiceContext } from '@/services/context';
import { MemoryHelloStore } from '@/store/memory';
import { DEMO_NOW, loadDemoEvent } from '@/store/seed';

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
  persistence: 'MEMORY_DEMO';
  clock: 'FIXED_DEMO_CLOCK';
}

type GlobalWithRuntime = typeof globalThis & { __helloRuntime?: Promise<Runtime> };
const g = globalThis as GlobalWithRuntime;

async function createRuntime(): Promise<Runtime> {
  const store = new MemoryHelloStore();
  await loadDemoEvent(store);
  const ctx = createContext(store, {
    now: () => DEMO_NOW,
    newId: (prefix) => `${prefix}_${crypto.randomUUID().slice(0, 12)}`,
    intentProvider: null,
  });
  return { store, ctx, persistence: 'MEMORY_DEMO', clock: 'FIXED_DEMO_CLOCK' };
}

/** Returns the same runtime for the life of the process, including across dev hot-reloads. */
export function getRuntime(): Promise<Runtime> {
  g.__helloRuntime ??= createRuntime();
  return g.__helloRuntime;
}

/** Discards all in-memory state. The next request re-seeds the demo event. Used by demo reset only. */
export function resetRuntime(): void {
  g.__helloRuntime = undefined;
}
