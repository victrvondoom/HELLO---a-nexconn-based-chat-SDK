import type { ActionEntry } from '@/domain/product';
import { applyAction, KEY_PATTERN, replay, type ActionRequest, type LedgerEntry, type LedgerHead } from '@/domain/ops/actions';
import type { HelloStore } from '@/store/store';

/**
 * Store-backed action ledger. Durable in Postgres (row-locked docMutate, unique document ids) and in memory.
 *
 *   1. Reserve the idempotency key: docPutIfAbsent(actionKeys, eventId:key). Losing the race → DUPLICATE.
 *   2. Advance the head in one docMutate: next seq, version check, new version.
 *   3. Append the entry: docPutIfAbsent(actionEntries, eventId:seq). Never edited afterwards.
 *   4. Record the outcome on the key.
 * A crash between 2 and 4 leaves a PENDING key; `recover` completes it from the head and the entries.
 * Not claimed: cross-region or multi-database consistency. Multi-instance safety holds only on Postgres.
 */
export type SubmitResult = { outcome: 'DUPLICATE'; seq: number | null } | { outcome: LedgerEntry['outcome']; seq: number; entry: ActionEntry };

const headId = (eventId: string) => eventId;

export async function submitAction(store: HelloStore, eventId: string, req: ActionRequest, now: number): Promise<SubmitResult> {
  if (!KEY_PATTERN.test(req.idempotencyKey)) throw new Error('Invalid idempotency key.');
  const keyId = `${eventId}:${req.idempotencyKey}`;
  if (!(await store.docPutIfAbsent('actionKeys', { id: keyId, eventId, seq: null, outcome: 'PENDING' }))) {
    return { outcome: 'DUPLICATE', seq: (await store.docGet('actionKeys', keyId))?.seq ?? null };
  }
  await store.docPutIfAbsent('actionHeads', { id: headId(eventId), eventId, seq: 0, versions: {} });
  let decided: LedgerEntry | null = null;
  await store.docMutate('actionHeads', headId(eventId), (head) => {
    const result = applyAction({ seq: head.seq, versions: head.versions }, req, now);
    decided = result.entry;
    return { ...head, seq: result.head.seq, versions: result.head.versions };
  });
  const entryDecided = decided as LedgerEntry | null;
  if (!entryDecided) throw new Error('Ledger head missing.');
  const entry: ActionEntry = { ...entryDecided, id: `${eventId}:${entryDecided.seq}`, eventId };
  await store.docPutIfAbsent('actionEntries', entry);
  await store.docMutate('actionKeys', keyId, (k) => ({ ...k, seq: entry.seq, outcome: entry.outcome }));
  return { outcome: entry.outcome, seq: entry.seq, entry };
}

export async function ledgerEntries(store: HelloStore, eventId: string): Promise<ActionEntry[]> {
  return (await store.docList('actionEntries', { eventId })).sort((a, b) => a.seq - b.seq);
}

/** Restart recovery: the head rebuilt from the append-only entries must equal the stored head. */
export async function verifyLedger(store: HelloStore, eventId: string): Promise<{ consistent: boolean; replayed: LedgerHead; stored: LedgerHead | null }> {
  const replayed = replay(await ledgerEntries(store, eventId));
  const head = await store.docGet('actionHeads', headId(eventId));
  const stored = head ? { seq: head.seq, versions: head.versions } : null;
  const consistent = stored === null ? replayed.seq === 0 : stored.seq === replayed.seq && JSON.stringify(Object.entries(stored.versions).sort()) === JSON.stringify(Object.entries(replayed.versions).sort());
  return { consistent, replayed, stored };
}

/** Completes keys left PENDING by a crash, from the entries that were written. */
export async function recover(store: HelloStore, eventId: string): Promise<number> {
  const entries = await ledgerEntries(store, eventId);
  let fixed = 0;
  for (const k of await store.docList('actionKeys', { eventId, outcome: 'PENDING' })) {
    const e = entries.find((x) => `${eventId}:${x.idempotencyKey}` === k.id);
    if (e && (await store.docMutate('actionKeys', k.id, (doc) => (doc.outcome === 'PENDING' ? { ...doc, seq: e.seq, outcome: e.outcome } : null)))) fixed += 1;
  }
  return fixed;
}
