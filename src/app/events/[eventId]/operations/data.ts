import type { HelloStore } from '@/store/store';

/** Signal patterns for an event, most confident first. Read-only; recomputation happens through the service. */
export async function listSignalPatternsFor(store: HelloStore, eventId: string) {
  const patterns = await store.listSignalPatterns(eventId);
  return [...patterns].sort((a, b) => b.confidence - a.confidence || a.id.localeCompare(b.id));
}
