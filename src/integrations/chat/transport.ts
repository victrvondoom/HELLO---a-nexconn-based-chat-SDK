import { SIGNATURE_HEADER, TIMESTAMP_HEADER, sign } from './signature';

/**
 * The boundary between HELLO and an external chat network (Nexconn first).
 *
 * Business logic never imports a chat SDK. It talks to a `ChatTransport`, which only has to deliver a
 * message to one person's linked account. Messages from the network come in through the signed inbound
 * endpoint (POST /api/integrations/chat/inbound) and run through the same pipeline as the app.
 *
 * Two transports ship:
 * - `in-app` (default): nothing leaves HELLO. Notifications are shown in the app only.
 * - `webhook`: HELLO sends each delivery to HELLO_CHAT_OUTBOUND_URL, signed with HELLO_CHAT_SECRET. A small
 *   bridge on the chat side (for Nexconn: a server that calls the Nexconn API) posts it to the person.
 *
 * A direct Nexconn transport is the same interface implemented with the Nexconn server API; see
 * docs/nexconn-integration.md. Any implementation must pass tests/integration/chat-gateway.test.ts.
 */
export interface OutboundChatMessage {
  /** Stable id of the delivery. Sent as the idempotency key: the receiver must not post it twice. */
  id: string;
  eventId: string;
  externalUserId: string;
  body: string;
  /** Link into HELLO, relative to the app's base URL. */
  href: string;
  createdAt: number;
}

export type DeliveryResult = { ok: true; reference: string | null } | { ok: false; retryable: boolean; reason: string };

export interface TransportStatus {
  state: 'IN_APP_ONLY' | 'CONNECTED' | 'MISCONFIGURED';
  detail: string;
}

export interface ChatTransport {
  /** Stored on links and deliveries, e.g. `webhook` or `nexconn`. */
  readonly name: string;
  /** True when deliveries leave HELLO. The in-app transport is false, and nothing is queued for it. */
  readonly external: boolean;
  describe(): TransportStatus;
  deliver(message: OutboundChatMessage): Promise<DeliveryResult>;
}

export function inAppTransport(): ChatTransport {
  return {
    name: 'in-app',
    external: false,
    describe: () => ({ state: 'IN_APP_ONLY', detail: 'Messages and notifications stay inside HELLO. No chat network is connected.' }),
    deliver: () => Promise.resolve({ ok: true, reference: null }),
  };
}

/** Minimum secret length: shorter secrets are refused rather than used. */
export const MIN_SECRET_LENGTH = 32;
const DELIVERY_TIMEOUT_MS = 5000;

export function webhookTransport(options: { url: string; secret: string; fetchImpl?: typeof fetch; now?: () => number }): ChatTransport {
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? (() => Date.now());
  const host = (() => {
    try {
      return new URL(options.url).host;
    } catch {
      return null;
    }
  })();
  return {
    name: 'webhook',
    external: true,
    describe: () => ({ state: 'CONNECTED', detail: `Deliveries are sent to ${host ?? 'the configured bridge'}, signed with HMAC-SHA256.` }),
    async deliver(message) {
      const body = JSON.stringify({ type: 'hello.delivery', ...message });
      const timestamp = now();
      const controller = new AbortController();
      const timer = setTimeout(() => {
        controller.abort();
      }, DELIVERY_TIMEOUT_MS);
      try {
        const response = await fetchImpl(options.url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            [TIMESTAMP_HEADER]: String(timestamp),
            [SIGNATURE_HEADER]: sign(options.secret, timestamp, body),
            'idempotency-key': message.id,
          },
          body,
          signal: controller.signal,
        });
        if (response.ok) {
          const reply = (await response.json().catch(() => null)) as { reference?: unknown } | null;
          return { ok: true, reference: typeof reply?.reference === 'string' ? reply.reference.slice(0, 200) : null };
        }
        // Client errors other than timeouts and rate limits will not succeed on a retry.
        const retryable = response.status >= 500 || response.status === 408 || response.status === 429;
        return { ok: false, retryable, reason: `The bridge answered HTTP ${response.status}.` };
      } catch {
        return { ok: false, retryable: true, reason: 'The bridge did not answer in time.' };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

/** Misconfiguration is reported, never silently replaced by a working-looking default. */
function misconfigured(detail: string): ChatTransport {
  return {
    name: 'webhook',
    external: false,
    describe: () => ({ state: 'MISCONFIGURED', detail }),
    deliver: () => Promise.resolve({ ok: false, retryable: false, reason: detail }),
  };
}

export function chatTransportFromEnv(env: Record<string, string | undefined>): ChatTransport {
  const url = (env.HELLO_CHAT_OUTBOUND_URL ?? '').trim();
  const secret = (env.HELLO_CHAT_SECRET ?? '').trim();
  if (!url && !secret) return inAppTransport();
  if (!url) return misconfigured('HELLO_CHAT_SECRET is set but HELLO_CHAT_OUTBOUND_URL is not. Nothing is delivered.');
  if (secret.length < MIN_SECRET_LENGTH) return misconfigured(`HELLO_CHAT_SECRET must be at least ${MIN_SECRET_LENGTH} characters. Nothing is delivered.`);
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return misconfigured('HELLO_CHAT_OUTBOUND_URL is not a valid URL. Nothing is delivered.');
  }
  const local = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
  if (parsed.protocol !== 'https:' && !local) return misconfigured('HELLO_CHAT_OUTBOUND_URL must use https (http is allowed for localhost only).');
  return webhookTransport({ url, secret });
}
