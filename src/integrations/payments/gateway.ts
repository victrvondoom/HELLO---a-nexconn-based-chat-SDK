/**
 * Payment gateway boundary. HELLO never holds card or bank details: a gateway (Razorpay, Stripe,
 * a UPI provider) does, and HELLO stores only the gateway's reference.
 *
 * Only the sandbox gateway exists in this build. It moves no money and every screen says so.
 * A live gateway is added by implementing this interface on the server with its secret key.
 */
export interface ChargeRequest {
  /** Sent to the gateway so a retried request can never charge twice. */
  idempotencyKey: string;
  payerId: string;
  payeeId: string;
  amountMinor: number;
  currency: string;
}

export type ChargeResult = { ok: true; reference: string } | { ok: false; reason: string };

export interface PaymentGateway {
  readonly name: string;
  /** True only for a gateway that moves real money. Shown in the UI. */
  readonly live: boolean;
  charge(request: ChargeRequest): Promise<ChargeResult>;
}

export function sandboxGateway(): PaymentGateway {
  return {
    name: 'sandbox',
    live: false,
    charge(request) {
      // Mirrors the usual test-card convention: an amount ending in .13 is declined.
      if (request.amountMinor % 100 === 13) return Promise.resolve({ ok: false, reason: 'The sandbox declined this amount (it ends in .13).' });
      return Promise.resolve({ ok: true, reference: `sbx_${request.idempotencyKey}` });
    },
  };
}
