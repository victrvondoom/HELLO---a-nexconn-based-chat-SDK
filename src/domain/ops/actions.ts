/**
 * Authoritative action model (pattern: server-authoritative state with sequence numbers and idempotency).
 * Pure: `applyAction` decides the outcome of one request against the current head; `replay` rebuilds the head from
 * the append-only entries, so the persisted log alone recovers state after a restart.
 */
export type ActionOutcome = 'APPLIED' | 'DUPLICATE' | 'STALE' | 'REJECTED';

export interface ActionRequest {
  idempotencyKey: string;
  kind: string;
  targetId: string;
  expectedVersion: number;
  actorId: string;
  payload: Record<string, string | number | boolean | null>;
}

export interface LedgerEntry {
  seq: number;
  idempotencyKey: string;
  kind: string;
  targetId: string;
  actorId: string;
  versionBefore: number;
  versionAfter: number;
  outcome: Exclude<ActionOutcome, 'DUPLICATE'>;
  reason: string;
  payload: ActionRequest['payload'];
  at: number;
}

export interface LedgerHead {
  seq: number;
  versions: Record<string, number>;
}

export const KEY_PATTERN = /^[A-Za-z0-9:._-]{8,120}$/;

export function applyAction(head: LedgerHead, req: ActionRequest, at: number): { head: LedgerHead; entry: LedgerEntry } {
  const current = head.versions[req.targetId] ?? 0;
  const seq = head.seq + 1;
  const base = { seq, idempotencyKey: req.idempotencyKey, kind: req.kind, targetId: req.targetId, actorId: req.actorId, versionBefore: current, payload: req.payload, at };
  if (!KEY_PATTERN.test(req.idempotencyKey)) return { head: { ...head, seq }, entry: { ...base, versionAfter: current, outcome: 'REJECTED', reason: 'Invalid idempotency key.' } };
  if (req.expectedVersion !== current) {
    return { head: { ...head, seq }, entry: { ...base, versionAfter: current, outcome: 'STALE', reason: `Expected version ${req.expectedVersion}, current ${current}.` } };
  }
  return { head: { seq, versions: { ...head.versions, [req.targetId]: current + 1 } }, entry: { ...base, versionAfter: current + 1, outcome: 'APPLIED', reason: '' } };
}

/** Rebuilds the head from entries. Throws if sequence numbers are not contiguous from 1. */
export function replay(entries: readonly LedgerEntry[]): LedgerHead {
  const sorted = [...entries].sort((a, b) => a.seq - b.seq);
  const head: LedgerHead = { seq: 0, versions: {} };
  for (const e of sorted) {
    if (e.seq !== head.seq + 1) throw new Error(`Ledger gap: expected seq ${head.seq + 1}, found ${e.seq}.`);
    head.seq = e.seq;
    if (e.outcome === 'APPLIED') head.versions[e.targetId] = e.versionAfter;
  }
  return head;
}
