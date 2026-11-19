import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { createHarness, type Harness } from './harness';
import { DomainError } from '@/domain/errors';
import { resetAllRateLimiters } from '@/lib/rate-limit';
import { notify } from '@/services/context';
import { eraseMe } from '@/services/rights';
import {
  DELIVERY_LEASE_MS,
  LINK_CODE_TTL_MS,
  MAX_DELIVERY_ATTEMPTS,
  backoffMs,
  createLinkCode,
  enqueueNotification,
  gatewayStatus,
  listChatLinks,
  processDeliveries,
  receiveInbound,
  unlinkChat,
} from '@/services/chat-gateway';
import { chatTransportFromEnv, webhookTransport, type ChatTransport, type DeliveryResult, type OutboundChatMessage } from '@/integrations/chat/transport';
import { SIGNATURE_HEADER, TIMESTAMP_HEADER, sign, verify } from '@/integrations/chat/signature';

afterEach(() => {
  resetAllRateLimiters();
});

/** A transport that records what it was asked to send, and fails on demand. */
function recordingTransport(results: DeliveryResult[] = []) {
  const sent: OutboundChatMessage[] = [];
  const transport: ChatTransport = {
    name: 'test',
    external: true,
    describe: () => ({ state: 'CONNECTED', detail: 'test transport' }),
    deliver: (message) => {
      sent.push(message);
      return Promise.resolve(results.shift() ?? { ok: true, reference: `ref-${sent.length}` });
    },
  };
  return { transport, sent };
}

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return 'OK';
  } catch (e: unknown) {
    return e instanceof DomainError ? e.code : 'THROWN';
  }
}

const inbound = (h: Harness, text: string, messageId: string, externalUserId = 'nx-ada') =>
  receiveInbound(h.ctx, 'test', { eventId: h.eventId, externalUserId, messageId, text });

async function linkedAda(h: Harness) {
  const { code } = await createLinkCode(h.ctx, h.eventId, h.users.attendeeAda);
  const linked = await inbound(h, `LINK ${code}`, 'm-link');
  expect(linked.linked).toBe(true);
}

describe('linking a chat account', () => {
  it('links only with a fresh code from the person’s own session, and each code works once', async () => {
    const h = await createHarness();
    const { code } = await createLinkCode(h.ctx, h.eventId, h.users.attendeeAda);
    const first = await inbound(h, `link ${code.toLowerCase()}`, 'm1');
    expect(first.reply).toMatch(/^Linked to Ada/);
    expect((await listChatLinks(h.ctx, h.eventId, h.users.attendeeAda)).map((l) => l.transport)).toEqual(['test']);
    // A second use of the same code, from another account, does nothing.
    const reuse = await inbound(h, `LINK ${code}`, 'm2', 'nx-mallory');
    expect(reuse.linked).toBe(false);
    expect(reuse.reply).toMatch(/not valid/);
  });

  it('refuses an expired code', async () => {
    const h = await createHarness();
    const { code } = await createLinkCode(h.ctx, h.eventId, h.users.attendeeAda);
    h.setNow(h.now() + LINK_CODE_TTL_MS + 1);
    expect((await inbound(h, `LINK ${code}`, 'm1')).linked).toBe(false);
  });

  it('lets only the owner remove a link', async () => {
    const h = await createHarness();
    await linkedAda(h);
    const [link] = await listChatLinks(h.ctx, h.eventId, h.users.attendeeAda);
    if (!link) throw new Error('expected a link');
    expect(await codeOf(unlinkChat(h.ctx, h.eventId, h.users.attendeeBen, link.id))).toBe('NOT_FOUND');
    await unlinkChat(h.ctx, h.eventId, h.users.attendeeAda, link.id);
    expect(await listChatLinks(h.ctx, h.eventId, h.users.attendeeAda)).toEqual([]);
  });
});

describe('messages from the chat network', () => {
  it('tells an unlinked account how to link, and runs nothing', async () => {
    const h = await createHarness();
    const before = (await h.store.listMessages(h.eventId)).length;
    const result = await inbound(h, 'The projector in Room 2 is broken', 'm1', 'nx-stranger');
    expect(result.linked).toBe(false);
    expect(result.reply).toMatch(/LINK <code>/);
    expect((await h.store.listMessages(h.eventId)).length).toBe(before);
  });

  it('runs a linked person’s message through the same pipeline as the app', async () => {
    const h = await createHarness();
    await linkedAda(h);
    const result = await inbound(h, 'The projector in Room 2 is broken', 'm2');
    expect(result.reply).toMatch(/Opened|Added/);
    const messages = await h.store.listMessages(h.eventId);
    expect(messages.at(-1)?.senderUserId).toBe(h.users.attendeeAda);
  });

  it('handles a message id once: a retried webhook gets the same reply and nothing runs again', async () => {
    const h = await createHarness();
    await linkedAda(h);
    const before = (await h.store.listMessages(h.eventId)).length;
    const results = await Promise.all([1, 2, 3].map(() => inbound(h, 'What is on in Room 4 today?', 'm-dup')));
    expect((await h.store.listMessages(h.eventId)).length).toBe(before + 1);
    expect(results.filter((r) => !r.replayed)).toHaveLength(1);
    const again = await inbound(h, 'What is on in Room 4 today?', 'm-dup');
    expect(again.replayed).toBe(true);
    expect(again.reply).toBe(results.find((r) => !r.replayed)?.reply);
  });
});

describe('notifications to the chat network', () => {
  it('queues a notification for each linked account, delivers it once, with its id as the idempotency key', async () => {
    const h = await createHarness();
    const { transport, sent } = recordingTransport();
    await linkedAda(h);
    h.ctx.afterNotify = async (n) => {
      await enqueueNotification(h.ctx, transport, n);
    };
    await notify(h.ctx, { eventId: h.eventId, recipientUserId: h.users.attendeeAda, kind: 'TEST', body: 'Your report is resolved.', href: '/events/x', dedupeParts: ['a'] });
    // The same notification again is de-duplicated, so it is not queued again either.
    await notify(h.ctx, { eventId: h.eventId, recipientUserId: h.users.attendeeAda, kind: 'TEST', body: 'Your report is resolved.', href: '/events/x', dedupeParts: ['a'] });
    // Ben has no linked account: nothing is queued for him.
    await notify(h.ctx, { eventId: h.eventId, recipientUserId: h.users.attendeeBen, kind: 'TEST', body: 'For Ben', href: '/', dedupeParts: ['b'] });
    expect(await processDeliveries(h.ctx, transport)).toEqual({ delivered: 1, retrying: 0, failed: 0 });
    expect(await processDeliveries(h.ctx, transport)).toEqual({ delivered: 0, retrying: 0, failed: 0 });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ externalUserId: 'nx-ada', body: 'Your report is resolved.' });
    const [delivery] = await h.store.docList('chatDeliveries', {});
    expect(sent[0]?.id).toBe(delivery?.id);
    expect(delivery).toMatchObject({ status: 'DELIVERED', attempts: 1, reference: 'ref-1' });
  });

  it('retries a failed delivery with backoff, then delivers it', async () => {
    const h = await createHarness();
    const failing: DeliveryResult = { ok: false, retryable: true, reason: 'bridge down' };
    const { transport, sent } = recordingTransport([failing, failing]);
    await linkedAda(h);
    await enqueueNotification(h.ctx, transport, { id: 'n1', eventId: h.eventId, recipientUserId: h.users.attendeeAda, kind: 'T', body: 'b', href: '/', dedupeKey: 'k', createdAt: h.now(), readAt: null });
    expect((await processDeliveries(h.ctx, transport)).retrying).toBe(1);
    // Not due yet: the backoff holds it.
    expect((await processDeliveries(h.ctx, transport)).retrying).toBe(0);
    h.setNow(h.now() + backoffMs(1));
    expect((await processDeliveries(h.ctx, transport)).retrying).toBe(1);
    h.setNow(h.now() + backoffMs(2));
    expect((await processDeliveries(h.ctx, transport)).delivered).toBe(1);
    expect(sent).toHaveLength(3);
  });

  it('gives up at once on a permanent failure, and after the maximum on repeated ones', async () => {
    const h = await createHarness();
    const permanent = recordingTransport([{ ok: false, retryable: false, reason: 'unknown account' }]);
    await linkedAda(h);
    const n = (id: string) => ({ id, eventId: h.eventId, recipientUserId: h.users.attendeeAda, kind: 'T', body: 'b', href: '/', dedupeKey: id, createdAt: h.now(), readAt: null });
    await enqueueNotification(h.ctx, permanent.transport, n('n1'));
    expect((await processDeliveries(h.ctx, permanent.transport)).failed).toBe(1);

    const flaky = recordingTransport(Array.from({ length: 20 }, () => ({ ok: false, retryable: true, reason: 'down' })));
    await enqueueNotification(h.ctx, flaky.transport, n('n2'));
    for (let i = 0; i < MAX_DELIVERY_ATTEMPTS; i += 1) {
      await processDeliveries(h.ctx, flaky.transport);
      h.setNow(h.now() + 10 * 60_000);
    }
    const failed = (await h.store.docList('chatDeliveries', { status: 'FAILED' })).find((d) => d.transport === 'test' && d.attempts === MAX_DELIVERY_ATTEMPTS);
    expect(failed?.lastError).toBe('down');
    expect(flaky.sent).toHaveLength(MAX_DELIVERY_ATTEMPTS);
  });

  it('sends each delivery once even with two workers at the same moment, and takes over a dead worker’s lease', async () => {
    const h = await createHarness();
    const { transport, sent } = recordingTransport();
    await linkedAda(h);
    await enqueueNotification(h.ctx, transport, { id: 'n1', eventId: h.eventId, recipientUserId: h.users.attendeeAda, kind: 'T', body: 'b', href: '/', dedupeKey: 'k', createdAt: h.now(), readAt: null });
    await Promise.all([processDeliveries(h.ctx, transport), processDeliveries(h.ctx, transport)]);
    expect(sent).toHaveLength(1);

    // A worker that claimed a delivery and then died leaves it SENDING; after the lease it is taken over.
    await enqueueNotification(h.ctx, transport, { id: 'n2', eventId: h.eventId, recipientUserId: h.users.attendeeAda, kind: 'T', body: 'b2', href: '/', dedupeKey: 'k2', createdAt: h.now(), readAt: null });
    const [stuck] = (await h.store.docList('chatDeliveries', { status: 'PENDING' })).filter((d) => d.body === 'b2');
    if (!stuck) throw new Error('expected a pending delivery');
    await h.store.docMutate('chatDeliveries', stuck.id, (d) => ({ ...d, status: 'SENDING', leaseUntil: h.now() + DELIVERY_LEASE_MS, attempts: 1 }));
    expect((await processDeliveries(h.ctx, transport)).delivered).toBe(0);
    h.setNow(h.now() + DELIVERY_LEASE_MS);
    expect((await processDeliveries(h.ctx, transport)).delivered).toBe(1);
  });

  it('shows delivery totals to organisers only, and erasure removes every chat record', async () => {
    const h = await createHarness();
    const { transport } = recordingTransport();
    await linkedAda(h);
    await enqueueNotification(h.ctx, transport, { id: 'n1', eventId: h.eventId, recipientUserId: h.users.attendeeAda, kind: 'T', body: 'b', href: '/', dedupeKey: 'k', createdAt: h.now(), readAt: null });
    expect((await gatewayStatus(h.ctx, h.eventId, h.users.attendeeAda, transport)).deliveries).toBeNull();
    expect((await gatewayStatus(h.ctx, h.eventId, h.users.organiserNadia, transport)).deliveries).toEqual({ pending: 1, delivered: 0, failed: 0 });
    await createLinkCode(h.ctx, h.eventId, h.users.attendeeAda);
    await eraseMe(h.ctx, h.users.attendeeAda);
    for (const collection of ['chatLinks', 'chatLinkCodes', 'chatDeliveries'] as const) {
      expect(await h.store.docList(collection, {})).toEqual([]);
    }
  });
});

describe('the signed webhook transport, against a real HTTP receiver', () => {
  const secret = 'x'.repeat(40);
  let server: Server | null = null;
  afterEach(async () => {
    await new Promise<void>((resolve) => {
      if (server) server.close(() => {
        resolve();
      });
      else resolve();
    });
    server = null;
  });

  async function receiver(status: number): Promise<{ url: string; got: Array<{ verified: boolean; idempotencyKey: string | undefined; body: unknown }> }> {
    const got: Array<{ verified: boolean; idempotencyKey: string | undefined; body: unknown }> = [];
    server = createServer((req: IncomingMessage, res) => {
      let raw = '';
      req.on('data', (c: Buffer) => (raw += c.toString()));
      req.on('end', () => {
        const check = verify(secret, req.headers[SIGNATURE_HEADER] as string, req.headers[TIMESTAMP_HEADER] as string, raw, Date.now());
        got.push({ verified: check.ok, idempotencyKey: req.headers['idempotency-key'] as string | undefined, body: JSON.parse(raw) as unknown });
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ reference: 'nx-msg-1' }));
      });
    });
    await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    return { url: `http://127.0.0.1:${port}/hello`, got };
  }

  const message: OutboundChatMessage = { id: 'dlv_1', eventId: 'evt-1', externalUserId: 'nx-ada', body: 'Hello', href: '/x', createdAt: 1 };

  it('signs every delivery so the receiver can verify it, and sends the idempotency key', async () => {
    const r = await receiver(200);
    const result = await webhookTransport({ url: r.url, secret }).deliver(message);
    expect(result).toEqual({ ok: true, reference: 'nx-msg-1' });
    expect(r.got[0]).toMatchObject({ verified: true, idempotencyKey: 'dlv_1', body: { type: 'hello.delivery', externalUserId: 'nx-ada' } });
  });

  it('treats server errors as retryable and client errors as permanent', async () => {
    expect(await webhookTransport({ url: (await receiver(503)).url, secret }).deliver(message)).toMatchObject({ ok: false, retryable: true });
    await new Promise<void>((resolve) => server?.close(() => {
      resolve();
    }));
    expect(await webhookTransport({ url: (await receiver(400)).url, secret }).deliver(message)).toMatchObject({ ok: false, retryable: false });
  });
});

describe('configuration', () => {
  it('reports misconfiguration instead of guessing', () => {
    expect(chatTransportFromEnv({}).describe().state).toBe('IN_APP_ONLY');
    expect(chatTransportFromEnv({ HELLO_CHAT_SECRET: 'short', HELLO_CHAT_OUTBOUND_URL: 'https://bridge.example.org/hello' }).describe().state).toBe('MISCONFIGURED');
    expect(chatTransportFromEnv({ HELLO_CHAT_SECRET: 's'.repeat(40), HELLO_CHAT_OUTBOUND_URL: 'http://bridge.example.org/hello' }).describe().state).toBe('MISCONFIGURED');
    expect(chatTransportFromEnv({ HELLO_CHAT_SECRET: 's'.repeat(40), HELLO_CHAT_OUTBOUND_URL: 'https://bridge.example.org/hello' }).external).toBe(true);
  });

  it('accepts only fresh, correctly signed requests', () => {
    const now = 1_700_000_000_000;
    const body = '{"a":1}';
    const good = sign('k'.repeat(40), now, body);
    expect(verify('k'.repeat(40), good, String(now), body, now).ok).toBe(true);
    expect(verify('k'.repeat(40), good, String(now), '{"a":2}', now)).toEqual({ ok: false, reason: 'MISMATCH' });
    expect(verify('z'.repeat(40), good, String(now), body, now)).toEqual({ ok: false, reason: 'MISMATCH' });
    expect(verify('k'.repeat(40), good, String(now), body, now + 6 * 60_000)).toEqual({ ok: false, reason: 'STALE' });
    expect(verify('k'.repeat(40), null, String(now), body, now)).toEqual({ ok: false, reason: 'MISSING' });
  });
});
