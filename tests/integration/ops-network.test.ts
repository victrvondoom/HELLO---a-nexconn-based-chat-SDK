import { describe, expect, it } from 'vitest';
import { createHarness } from './harness';
import { DomainError } from '@/domain/errors';
import { ledgerEntries, recover, submitAction, verifyLedger } from '@/services/ops/action-ledger';
import { getOwnership, handOff } from '@/services/ops/handoff';
import { decideProposal, runResilienceCheck } from '@/services/resilience';

const req = (key: string, expectedVersion: number) => ({ idempotencyKey: key, kind: 'TEST', targetId: 'room:r-3', expectedVersion, actorId: 'u', payload: {} });
async function code(p: Promise<unknown>) {
  return p.then(() => 'OK', (e: unknown) => (e instanceof DomainError ? e.code : 'THREW'));
}

describe('action ledger on the store', () => {
  it('records one entry per idempotency key under concurrency, one winner per version, and replays', async () => {
    const h = await createHarness();
    const same = await Promise.all(Array.from({ length: 8 }, () => submitAction(h.store, h.eventId, req('same-key-1', 0), 1)));
    expect(same.filter((r) => r.outcome === 'APPLIED')).toHaveLength(1);
    const race = await Promise.all(Array.from({ length: 8 }, (_, i) => submitAction(h.store, h.eventId, req(`race-key-${i}`, 1), 2)));
    expect(race.filter((r) => r.outcome === 'APPLIED')).toHaveLength(1);
    expect(race.filter((r) => r.outcome === 'STALE')).toHaveLength(7);
    expect((await ledgerEntries(h.store, h.eventId)).map((e) => e.seq)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect((await verifyLedger(h.store, h.eventId)).consistent).toBe(true);
    expect(await recover(h.store, h.eventId)).toBe(0);
  });

  it('records Steadfast decisions in the ledger, once', async () => {
    const h = await createHarness();
    const p = await runResilienceCheck(h.ctx, h.eventId, h.users.organiserNadia, { incidentId: 'inc-seed-av-r3' });
    await decideProposal(h.ctx, h.eventId, h.users.organiserNadia, p.id, 'APPROVE');
    const entries = await ledgerEntries(h.store, h.eventId);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ kind: 'STEADFAST_APPROVE', outcome: 'APPLIED', actorId: h.users.organiserNadia });
  });
});

describe('incident handoff on the store', () => {
  it('enforces staff permissions server-side and keeps one conversation', async () => {
    const h = await createHarness();
    const inc = 'inc-seed-av-r3';
    expect(await code(getOwnership(h.ctx, h.eventId, h.users.attendeeAda, inc))).toBe('FORBIDDEN');
    expect(await code(handOff(h.ctx, h.eventId, h.users.opsKiri, inc, { action: 'ASSIGN', assigneeId: h.users.attendeeAda }))).toBe('VALIDATION_FAILED');
    await handOff(h.ctx, h.eventId, h.users.opsKiri, inc, { action: 'REQUEST_STAFF' });
    await handOff(h.ctx, h.eventId, h.users.opsKiri, inc, { action: 'ASSIGN', assigneeId: h.users.opsLena });
    expect(await code(handOff(h.ctx, h.eventId, h.users.opsKiri, inc, { action: 'TAKE_OVER' }))).toBe('INVALID_TRANSITION');
    const owned = await handOff(h.ctx, h.eventId, h.users.opsLena, inc, { action: 'TAKE_OVER' });
    expect(owned).toMatchObject({ state: 'HUMAN_OWNED', ownerUserId: h.users.opsLena, conversationId: inc });
    const back = await handOff(h.ctx, h.eventId, h.users.opsLena, inc, { action: 'HAND_BACK' });
    expect(back.state).toBe('AI_TRIAGE');
    expect(back.transitions).toHaveLength(4);
    expect((await h.store.listAudit(h.eventId)).filter((a) => a.action.startsWith('handoff.'))).toHaveLength(4);
  });
});
