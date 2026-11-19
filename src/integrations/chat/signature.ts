import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Signatures for the chat webhook protocol, in both directions.
 *
 * The signed string is `${timestamp}.${rawBody}`: HMAC-SHA256 with the shared secret, hex, sent as
 * `x-hello-signature: v1=<hex>` with `x-hello-timestamp: <unix ms>`. A receiver accepts a request only when
 * the signature matches (compared in constant time) and the timestamp is within TOLERANCE_MS of its own
 * clock, so a captured request cannot be replayed later. The same scheme as Stripe's and Slack's, so any
 * bridge can implement it in a few lines.
 */
export const TOLERANCE_MS = 5 * 60 * 1000;
export const SIGNATURE_HEADER = 'x-hello-signature';
export const TIMESTAMP_HEADER = 'x-hello-timestamp';

export function sign(secret: string, timestamp: number, rawBody: string): string {
  return `v1=${createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex')}`;
}

export type VerifyResult = { ok: true } | { ok: false; reason: 'MISSING' | 'STALE' | 'MISMATCH' };

export function verify(secret: string, signature: string | null, timestamp: string | null, rawBody: string, now: number): VerifyResult {
  if (!signature || !timestamp || !/^\d{1,16}$/.test(timestamp)) return { ok: false, reason: 'MISSING' };
  const at = Number(timestamp);
  if (Math.abs(now - at) > TOLERANCE_MS) return { ok: false, reason: 'STALE' };
  const expected = Buffer.from(sign(secret, at, rawBody));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return { ok: false, reason: 'MISMATCH' };
  return { ok: true };
}
