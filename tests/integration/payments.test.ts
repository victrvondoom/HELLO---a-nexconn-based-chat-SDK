import { describe, expect, it } from 'vitest';
import { createHarness } from './harness';
import { follow } from '@/services/social';
import { cancelPayment, confirmPayment, draftPayment, listPayments, PAYMENT_LIMITS } from '@/services/payments';
import { DomainError } from '@/domain/errors';

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'OK';
  } catch (e) {
    return e instanceof DomainError ? e.code : 'THROWN';
  }
}

async function pair() {
  const h = await createHarness();
  const { attendeeAda: ada, attendeeBen: ben, attendeeGus: dev } = h.users;
  await follow(h.ctx, h.eventId, ada, ben);
  await follow(h.ctx, h.eventId, ben, ada);
  return { h, ada, ben, dev };
}

describe('payments in a private thread', () => {
  it('a spoken draft charges nothing until the payer confirms', async () => {
    const { h, ada, ben } = await pair();
    const draft = await draftPayment(h.ctx, h.eventId, ada, ben, { utterance: 'pay Ben 200 rupees for lunch', origin: 'VOICE' });
    expect(draft).toMatchObject({ status: 'AWAITING_CONFIRMATION', amountMinor: 20000, providerRef: null });
    // The payee cannot see or confirm an unconfirmed draft.
    expect((await listPayments(h.ctx, h.eventId, ben, ada)).payments).toHaveLength(0);
    expect(await code(confirmPayment(h.ctx, h.eventId, ben, draft.id, draft.version))).toBe('NOT_FOUND');
    const paid = await confirmPayment(h.ctx, h.eventId, ada, draft.id, draft.version);
    expect(paid.status).toBe('SUCCEEDED');
    expect(paid.providerRef).toMatch(/^sbx_/);
    expect((await listPayments(h.ctx, h.eventId, ben, ada)).payments).toHaveLength(1);
    expect((await h.store.listNotifications(ben)).some((n) => n.kind === 'PAYMENT_RECEIVED')).toBe(true);
  });

  it('a double confirmation charges once', async () => {
    const { h, ada, ben } = await pair();
    const draft = await draftPayment(h.ctx, h.eventId, ada, ben, { amountMinor: 5000, currency: 'INR', note: null, origin: 'TYPED' });
    const results = await Promise.all([
      code(confirmPayment(h.ctx, h.eventId, ada, draft.id, draft.version)),
      code(confirmPayment(h.ctx, h.eventId, ada, draft.id, draft.version)),
    ]);
    expect(results.filter((r) => r === 'OK')).toHaveLength(1);
    expect(await code(confirmPayment(h.ctx, h.eventId, ada, draft.id, draft.version + 2))).toBe('INVALID_TRANSITION');
  });

  it('refuses strangers, a wrong spoken name, expired drafts and amounts over the limits', async () => {
    const { h, ada, ben, dev } = await pair();
    expect(await code(draftPayment(h.ctx, h.eventId, ada, dev, { utterance: 'pay 10 rupees', origin: 'TYPED' }))).toBe('FORBIDDEN');
    expect(await code(draftPayment(h.ctx, h.eventId, ada, ben, { utterance: 'pay Gus 10 rupees', origin: 'VOICE' }))).toBe('VALIDATION_FAILED');
    expect(await code(draftPayment(h.ctx, h.eventId, ada, ben, { amountMinor: PAYMENT_LIMITS.perPaymentMinor + 1, currency: 'INR', note: null, origin: 'TYPED' }))).toBe('VALIDATION_FAILED');
    const stale = await draftPayment(h.ctx, h.eventId, ada, ben, { utterance: 'pay 10 rupees', origin: 'TYPED' });
    h.setNow(h.now() + PAYMENT_LIMITS.draftTtlMs + 1);
    expect(await code(confirmPayment(h.ctx, h.eventId, ada, stale.id, stale.version))).toBe('INVALID_TRANSITION');
    for (let i = 0; i < 4; i += 1) {
      const d = await draftPayment(h.ctx, h.eventId, ada, ben, { amountMinor: PAYMENT_LIMITS.perPaymentMinor, currency: 'INR', note: null, origin: 'TYPED' });
      await confirmPayment(h.ctx, h.eventId, ada, d.id, d.version);
    }
    const over = await draftPayment(h.ctx, h.eventId, ada, ben, { amountMinor: 100, currency: 'INR', note: null, origin: 'TYPED' });
    expect(await code(confirmPayment(h.ctx, h.eventId, ada, over.id, over.version))).toBe('VALIDATION_FAILED');
  });

  it('records a gateway decline and lets the payer cancel a draft', async () => {
    const { h, ada, ben } = await pair();
    const declined = await draftPayment(h.ctx, h.eventId, ada, ben, { utterance: 'pay 10.13 rupees', origin: 'TYPED' });
    expect((await confirmPayment(h.ctx, h.eventId, ada, declined.id, declined.version)).status).toBe('FAILED');
    const draft = await draftPayment(h.ctx, h.eventId, ada, ben, { utterance: 'pay 10 rupees', origin: 'TYPED' });
    expect((await cancelPayment(h.ctx, h.eventId, ada, draft.id, draft.version)).status).toBe('CANCELLED');
  });
});
