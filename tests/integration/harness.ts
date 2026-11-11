import { createContext, type ServiceContext } from '@/services/context';
import { MemoryHelloStore } from '@/store/memory';
import { DEMO_EVENT_ID, DEMO_NOW, DEMO_USERS, loadDemoEvent } from '@/store/seed';
import type { IntentProvider } from '@/ai/intent';
import type { WebSearchProvider } from '@/agents/web';
import type { Incident } from '@/domain/types';

/** A fresh demo store with a controllable clock and sequential IDs. */
export async function createHarness(options: { provider?: IntentProvider | null; webSearch?: WebSearchProvider | null } = {}) {
  const store = new MemoryHelloStore();
  await loadDemoEvent(store);
  let clock = DEMO_NOW;
  let sequence = 0;
  const ctx: ServiceContext = createContext(store, {
    now: () => clock,
    newId: (prefix) => `${prefix}-${++sequence}`,
    intentProvider: options.provider ?? null,
    webSearch: options.webSearch ?? null,
    webSearchTimeoutMs: 200,
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
