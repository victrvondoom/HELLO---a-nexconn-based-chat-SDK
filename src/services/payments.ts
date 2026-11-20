import { z } from 'zod';
import { DomainError } from '../domain/errors';
import { PAYMENT_CURRENCIES, formatMoney, parsePaymentUtterance, type PaymentDraft } from '../domain/payments/voice';
import type { Payment } from '../domain/types';
import { audit, notify, requireCapability, type ServiceContext } from './context';

/**
 * Payments between two connected people, started inside their private thread.
 *
 * Rules:
 * - Speech or text only drafts a payment. The payer must confirm it on screen before the gateway is called.
 * - Only mutual connections can pay each other, the same rule as private messages.
 * - A draft expires after five minutes, has a per-payment cap and a rolling daily cap.
 * - Confirmation is version-checked and the gateway gets an idempotency key, so a double tap charges once.
 */
export const PAYMENT_LIMITS = { perPaymentMinor: 500_000, perDayMinor: 2_000_000, draftTtlMs: 5 * 60 * 1000 } as const;

export const DraftBody = z.union([
  z.object({ utterance: z.string().trim().min(3).max(300), origin: z.enum(['VOICE', 'TYPED']) }),
  z.object({
    amountMinor: z.number().int().positive(),
    currency: z.enum(PAYMENT_CURRENCIES),
    note: z.string().trim().max(80).nullable(),
    origin: z.enum(['VOICE', 'TYPED']),
  }),
]);

export const PaymentActionBody = z.object({ action: z.enum(['confirm', 'cancel']), expectedVersion: z.number().int().nonnegative() });

async function connected(ctx: ServiceContext, a: string, b: string): Promise<boolean> {
  const [aFollows, bFollows] = await Promise.all([ctx.store.listFollowing(a), ctx.store.listFollowing(b)]);
  return aFollows.some((f) => f.followeeId === b) && bFollows.some((f) => f.followeeId === a);
}

async function requirePair(ctx: ServiceContext, eventId: string, me: string, peerId: string): Promise<void> {
  await requireCapability(ctx, eventId, me, 'message.send');
  if (me === peerId) throw new DomainError('VALIDATION_FAILED', 'You cannot pay yourself.');
  if (!(await ctx.store.findMembership(eventId, peerId)) || !(await connected(ctx, me, peerId))) {
    throw new DomainError('FORBIDDEN', 'You can only pay people you are connected with.');
  }
}

export interface PaymentThread {
  gateway: { name: string; live: boolean };
  payments: Payment[];
}

export async function listPayments(ctx: ServiceContext, eventId: string, me: string, peerId: string): Promise<PaymentThread> {
  await requirePair(ctx, eventId, me, peerId);
  const now = ctx.now();
  const payments = (await ctx.store.listPaymentsBetween(me, peerId))
    // The payee never sees a draft the payer has not confirmed.
    .filter((p) => p.payerId === me || p.status === 'SUCCEEDED')
    .map((p) => (p.status === 'AWAITING_CONFIRMATION' && now >= p.expiresAt ? { ...p, status: 'EXPIRED' as const } : p));
  return { gateway: { name: ctx.payments.name, live: ctx.payments.live }, payments };
}

/** Creates a draft from speech or from explicit fields. Charges nothing. */
export async function draftPayment(ctx: ServiceContext, eventId: string, payerId: string, payeeId: string, raw: unknown): Promise<Payment> {
  await requirePair(ctx, eventId, payerId, payeeId);
  const parsed = DraftBody.safeParse(raw);
  if (!parsed.success) throw new DomainError('VALIDATION_FAILED', 'Say or type an amount, for example "pay 200 rupees for lunch".');

  let draft: PaymentDraft;
  if ('utterance' in parsed.data) {
    const fromSpeech = parsePaymentUtterance(parsed.data.utterance);
    if (!fromSpeech) throw new DomainError('VALIDATION_FAILED', 'I could not hear an amount. Try "pay 200 rupees for lunch".');
    // A spoken name that is not this thread's person is refused rather than guessed.
    if (fromSpeech.spokenPayee) {
      const payee = await ctx.store.getUser(payeeId);
      const first = payee?.displayName.split(/\s+/)[0]?.toLowerCase() ?? '';
      if (first !== fromSpeech.spokenPayee.toLowerCase()) {
        throw new DomainError('VALIDATION_FAILED', `You said "${fromSpeech.spokenPayee}", but this chat is with ${payee?.displayName ?? 'someone else'}. Open their chat to pay them.`);
      }
    }
    draft = fromSpeech;
  } else {
    draft = { amountMinor: parsed.data.amountMinor, currency: parsed.data.currency, note: parsed.data.note, spokenPayee: null };
  }

  if (draft.amountMinor > PAYMENT_LIMITS.perPaymentMinor) {
    throw new DomainError('VALIDATION_FAILED', `One payment can be at most ${formatMoney(PAYMENT_LIMITS.perPaymentMinor, draft.currency)}.`);
  }
  const now = ctx.now();
  const payment: Payment = {
    id: ctx.newId('pay'),
    eventId,
    payerId,
    payeeId,
    amountMinor: draft.amountMinor,
    currency: draft.currency,
    note: draft.note,
    origin: parsed.data.origin,
    status: 'AWAITING_CONFIRMATION',
    provider: ctx.payments.name,
    providerRef: null,
    failureReason: null,
    createdAt: now,
    expiresAt: now + PAYMENT_LIMITS.draftTtlMs,
    settledAt: null,
    version: 0,
  };
  await ctx.store.insertPayment(payment);
  return payment;
}

async function loadOwn(ctx: ServiceContext, eventId: string, payerId: string, paymentId: string): Promise<Payment> {
  const payment = await ctx.store.getPayment(paymentId);
  // Only the payer can act on a draft. Anyone else learns nothing about it.
  if (!payment || payment.eventId !== eventId || payment.payerId !== payerId) throw new DomainError('NOT_FOUND', 'Payment not found.');
  return payment;
}

export async function cancelPayment(ctx: ServiceContext, eventId: string, payerId: string, paymentId: string, expectedVersion: number): Promise<Payment> {
  const payment = await loadOwn(ctx, eventId, payerId, paymentId);
  if (payment.status !== 'AWAITING_CONFIRMATION') throw new DomainError('INVALID_TRANSITION', 'This payment can no longer be cancelled.');
  return ctx.store.updatePayment(paymentId, expectedVersion, { status: 'CANCELLED' });
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Money committed by a payer in one currency over the last 24 hours: payments that succeeded, plus payments
 * being charged right now (PROCESSING). A payment stuck in PROCESSING stops counting a day after it was made.
 */
export function dailyCommitted(payments: readonly Payment[], currency: Payment['currency'], now: number): number {
  const dayAgo = now - DAY_MS;
  return payments
    .filter((p) => p.currency === currency)
    .filter((p) => (p.status === 'SUCCEEDED' && (p.settledAt ?? 0) > dayAgo) || (p.status === 'PROCESSING' && p.createdAt > dayAgo))
    .reduce((sum, p) => sum + p.amountMinor, 0);
}

/** The payer's on-screen confirmation. This, not the voice, authorises the charge. */
export async function confirmPayment(ctx: ServiceContext, eventId: string, payerId: string, paymentId: string, expectedVersion: number): Promise<Payment> {
  const payment = await loadOwn(ctx, eventId, payerId, paymentId);
  if (payment.status !== 'AWAITING_CONFIRMATION') throw new DomainError('INVALID_TRANSITION', 'This payment was already decided.');
  const now = ctx.now();
  if (now >= payment.expiresAt) {
    await ctx.store.updatePayment(paymentId, expectedVersion, { status: 'EXPIRED' });
    throw new DomainError('INVALID_TRANSITION', 'This payment expired before it was confirmed. Start it again.');
  }
  await requirePair(ctx, eventId, payerId, payment.payeeId);

  // Claim the draft first: PROCESSING. A second tap or a second tab fails this version check and never
  // reaches the gateway.
  const claimed = await ctx.store.updatePayment(paymentId, expectedVersion, { status: 'PROCESSING', failureReason: null });

  // The daily cap is checked after the claim, and counts payments that are being charged right now as well as
  // those that succeeded. It used to count only SUCCEEDED payments, before claiming, so two drafts confirmed
  // at the same moment both saw the same total and both were charged past the cap.
  if (dailyCommitted(await ctx.store.listPaymentsFrom(payerId), payment.currency, now) > PAYMENT_LIMITS.perDayMinor) {
    // Give the draft back, so the person can confirm it later or cancel it.
    await ctx.store.updatePayment(paymentId, claimed.version, { status: 'AWAITING_CONFIRMATION' });
    throw new DomainError('VALIDATION_FAILED', `This would pass your daily limit of ${formatMoney(PAYMENT_LIMITS.perDayMinor, payment.currency)}.`);
  }

  let result;
  try {
    result = await ctx.payments.charge({ idempotencyKey: payment.id, payerId, payeeId: payment.payeeId, amountMinor: payment.amountMinor, currency: payment.currency });
  } catch {
    result = { ok: false as const, reason: 'The payment service did not answer. Nothing was charged by HELLO; check with the provider before retrying.' };
  }
  const settled = await ctx.store.updatePayment(paymentId, claimed.version, result.ok
    ? { status: 'SUCCEEDED', providerRef: result.reference, settledAt: ctx.now() }
    : { status: 'FAILED', failureReason: result.reason });

  await audit(ctx, eventId, payerId, result.ok ? 'payment.succeeded' : 'payment.failed', 'payment', paymentId, `${formatMoney(payment.amountMinor, payment.currency)} via ${ctx.payments.name}`);
  if (result.ok) {
    await notify(ctx, {
      eventId,
      recipientUserId: payment.payeeId,
      kind: 'PAYMENT_RECEIVED',
      body: `You received ${formatMoney(payment.amountMinor, payment.currency)}${ctx.payments.live ? '' : ' (sandbox, no real money)'}.`,
      href: `/events/${eventId}/messages/${payerId}`,
      dedupeParts: [paymentId],
    });
  }
  return settled;
}
