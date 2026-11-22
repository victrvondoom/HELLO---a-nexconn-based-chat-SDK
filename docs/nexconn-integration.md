# Nexconn integration

HELLO talks to chat networks through one boundary, the **chat gateway**. Everything on the HELLO side is built
and tested: linking accounts, signed inbound messages, the delivery outbox with retries, live updates, erasure.
Connecting Nexconn means writing one small piece on the Nexconn side. This page says exactly what that piece
must do.

## What already works (tested)

| Piece | Where | Tests |
|---|---|---|
| Transport boundary (`ChatTransport`: `deliver`, `describe`) | `src/integrations/chat/transport.ts` | `tests/integration/chat-gateway.test.ts` |
| Signed webhook transport (HMAC-SHA256, replay window, idempotency key) | same file, `src/integrations/chat/signature.ts` | real HTTP receiver in the same test file |
| Inbound endpoint, one run per message id | `POST /api/integrations/chat/inbound` | same, plus `tests/e2e/chat-bridge-flow.mjs` |
| Account linking with one-time codes | `src/services/chat-gateway.ts` | same |
| Delivery outbox: lease, backoff, max attempts, one send across instances | same | same |
| Settings UI: link, unlink, transport state, delivery totals | `src/components/settings/ChatLinks.tsx` | `tests/e2e/chat-bridge-flow.mjs` |

## How it fits together

```
 Nexconn app (person)                      HELLO
 ────────────────────                      ─────
 sends "LINK AB12CD34"  ──► your bridge ──► POST /api/integrations/chat/inbound  (signed)
                                            → links nx user ↔ HELLO person
 sends "Projector broken in Room 2"  ──►  ──► same endpoint → same pipeline as the app
                         ◄── reply in the HTTP response ◄──
 receives notification ◄── your bridge ◄── POST HELLO_CHAT_OUTBOUND_URL (signed, idempotency-key)
```

The bridge is the only Nexconn-specific code. It can be a few dozen lines on any server you run.

## Option A (recommended): a bridge using the signed webhook protocol

1. **Configure HELLO.**
   ```bash
   HELLO_CHAT_SECRET=<a random string of 32+ characters, shared with the bridge>
   HELLO_CHAT_OUTBOUND_URL=https://your-bridge.example.org/hello   # https required except for localhost
   ```
   Settings then show "Chat network connected". With either variable missing or invalid, Settings say
   "misconfigured" and nothing is sent.

2. **Inbound: Nexconn → HELLO.** For each message a person sends to your HELLO bot in Nexconn, POST to
   `https://<hello>/api/integrations/chat/inbound`:
   ```json
   { "eventId": "evt-demo-hello-summit", "externalUserId": "<Nexconn user id>", "messageId": "<Nexconn message id>", "text": "…" }
   ```
   with headers `x-hello-timestamp: <unix ms>` and `x-hello-signature: v1=<hex HMAC-SHA256 of "<timestamp>.<raw body>">`.
   Post `data.reply` back to the person in Nexconn. A `202` means an identical message is still running: retry
   shortly. Retrying any message is safe; it runs once.

3. **Outbound: HELLO → Nexconn.** Accept POSTs on `HELLO_CHAT_OUTBOUND_URL`. Verify the same two headers. The body is
   `{ "type": "hello.delivery", "id", "eventId", "externalUserId", "body", "href", "createdAt" }`. Send `body` (and the
   link `<hello base URL><href>`) to `externalUserId` in Nexconn. Treat `idempotency-key` (= `id`) as already sent if
   you have seen it. Answer `200` with `{ "reference": "<Nexconn message id>" }`. Answer `5xx` for a temporary failure
   (HELLO retries with backoff) and `4xx` for a permanent one (HELLO stops).

4. **Check it.** `tests/e2e/chat-bridge-flow.mjs` is a working bridge in miniature: it verifies HELLO's signatures,
   signs its own requests, links an account, sends a message, receives a notification. Your bridge must pass the
   same flow.

## Option B: a direct `ChatTransport` in HELLO

If you prefer HELLO to call Nexconn's server API itself, implement `ChatTransport` (name `nexconn`, `external: true`,
`deliver` sends one text message to `externalUserId` and returns `{ ok, retryable, reason }`), return it from
`chatTransportFromEnv` when your Nexconn server credentials are set, and keep `POST /api/integrations/chat/inbound`
as the target of Nexconn's message webhook. Nothing else in HELLO changes. Run `tests/integration/chat-gateway.test.ts`
with your transport: every rule there (one send per delivery, retries, permanent failures) must still hold.

## The browser SDK (only if you embed Nexconn chat in HELLO's pages)

Verified from `@nexconn/chat@26.2.1` type definitions (`docs/IMPLEMENTATION_AUDIT.md` §2): `NCEngine.initialize({ appKey })`,
`NCEngine.connect({ token })`, `addMessageHandler`, channel classes such as `DirectChannel` and `GroupChannel`, and
`SendTextMessageParams`. `connect` needs a user token that only your server can issue with the app secret; that
token API was not verified, so HELLO does not include one. The SDK needs a browser, so call it from a client
component and never send the app secret to the browser.

## Token issuance (written from the docs, 2026-11-22)

`POST /api/nexconn/token` (signed-in HELLO person) calls `POST https://<base>/v4/auth/access-token/issue` with headers
`App-Key`, `Nonce`, `Timestamp` (ms) and `Signature = hex SHA-1(AppSecret + Nonce + Timestamp)`, body
`{ userId, name }`, and returns `{ appKey, area, nexconnUserId, token }`. Base URL by `NEXCONN_AREA`: SG
`api.sg-light-api.com` / `api-b.sg-light-api.com`, NA `api.us-light-api.com` / `api-b…`, SA `api.sau-light-api.com` /
`api-b…`; the backup is used after a 5 s timeout, a network error or a 5xx; a 401 is not retried. Sources:
docs.nexconn.ai `/platform-chat-api/prepare-to-use-api/auth.md`, `/base-url.md`, `/platform-chat-api/user/register.md`.
Checked live: both Singapore hosts answer `401 / 1004 Signature error` to a deliberately wrong signature. A real
token has not been issued yet: that needs `NEXCONN_APP_SECRET`.

## Not verified, and why

- A token issued with the real App Secret, and a browser connecting with it (needs `NEXCONN_APP_SECRET`).
- Nexconn's webhook format.
  The bridge (Option A) or the transport (Option B) is where they go; nothing else in HELLO depends on them.
- Delivery receipts for every Nexconn message type.

## Privacy

- Only people who linked an account get chat deliveries. Linking needs a code shown inside their own session.
- Deliveries carry the notification text only. Private messages stay end-to-end encrypted in HELLO; their
  notification says only that a message arrived.
- Erasure deletes links, unused codes, queued deliveries and the record of handled chat messages.
