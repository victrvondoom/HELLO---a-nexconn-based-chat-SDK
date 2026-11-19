import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { DomainError } from '../domain/errors';
import type { ChatDelivery, ChatInbound, ChatLink } from '../domain/product';
import type { Notification } from '../domain/types';
import { roleHasCapability } from '../domain/permissions';
import { consumeAction } from '../lib/action-limits';
import type { ChatTransport, DeliveryResult, TransportStatus } from '../integrations/chat/transport';
import { audit, requireCapability, type ServiceContext } from './context';
import { handleMessage, MAX_MESSAGE_LENGTH } from './pipeline';

/**
 * The chat gateway: HELLO on an external chat network (Nexconn first), through a `ChatTransport`.
 *
 * Linking. A person creates a one-time code in HELLO and sends `LINK <code>` from their chat account. Only
 * then does that account act as them: nobody can claim another person's HELLO account, because the code is
 * only ever shown inside that person's signed-in session. Codes are stored hashed, expire after ten minutes
 * and work once.
 *
 * Inbound. A message from a linked account runs through the same pipeline, rules and limits as one typed in
 * the app. Each message id is handled once: a retried webhook gets the same reply, and a duplicate arriving
 * while the first is still running is told so instead of running it twice.
 *
 * Outbound. Each new notification for a person with a linked account becomes a delivery in an outbox. A
 * worker claims each delivery with a lease (only one worker on any instance sends it), sends it with its id
 * as the idempotency key, and retries with exponential backoff, up to MAX_DELIVERY_ATTEMPTS.
 */

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const LINK_CODE_TTL_MS = 10 * 60 * 1000;
const MAX_ACTIVE_CODES = 3;
export const MAX_DELIVERY_ATTEMPTS = 8;
export const DELIVERY_LEASE_MS = 30_000;

const sha = (value: string) => createHash('sha256').update(value).digest('hex');

function newLinkCode(): string {
  const bytes = randomBytes(8);
  let out = '';
  for (let i = 0; i < 8; i += 1) out += CODE_ALPHABET.charAt((bytes[i] ?? 0) % CODE_ALPHABET.length);
  return out;
}

// ---------- linking ----------

export async function createLinkCode(ctx: ServiceContext, eventId: string, userId: string): Promise<{ code: string; expiresAt: number }> {
  await requireCapability(ctx, eventId, userId, 'message.send');
  const now = ctx.now();
  const active = (await ctx.store.docList('chatLinkCodes', { userId })).filter((c) => c.expiresAt > now);
  if (active.length >= MAX_ACTIVE_CODES) throw new DomainError('RATE_LIMITED', 'You already have three codes waiting. Use one, or wait ten minutes.');
  const code = newLinkCode();
  await ctx.store.docPut('chatLinkCodes', { id: sha(code), userId, eventId, createdAt: now, expiresAt: now + LINK_CODE_TTL_MS });
  await audit(ctx, eventId, userId, 'chat.link_code', 'user', userId, 'Created a one-time code to link a chat account.');
  return { code, expiresAt: now + LINK_CODE_TTL_MS };
}

export interface ChatLinkView {
  id: string;
  transport: string;
  /** The external account id, shortened so a screenshot does not leak it whole. */
  account: string;
  createdAt: number;
}

const shorten = (id: string) => (id.length <= 8 ? id : `${id.slice(0, 4)}…${id.slice(-4)}`);

export async function listChatLinks(ctx: ServiceContext, eventId: string, userId: string): Promise<ChatLinkView[]> {
  await requireCapability(ctx, eventId, userId, 'event.read');
  return (await ctx.store.docList('chatLinks', { userId, eventId }))
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((l) => ({ id: l.id, transport: l.transport, account: shorten(l.externalUserId), createdAt: l.createdAt }));
}

export async function unlinkChat(ctx: ServiceContext, eventId: string, userId: string, linkId: string): Promise<void> {
  await requireCapability(ctx, eventId, userId, 'event.read');
  const link = linkId.length <= 200 ? await ctx.store.docGet('chatLinks', linkId) : null;
  // Someone else's link looks exactly like one that does not exist.
  if (!link || link.userId !== userId || link.eventId !== eventId) throw new DomainError('NOT_FOUND', 'That chat link does not exist.');
  await ctx.store.docDelete('chatLinks', link.id);
  await audit(ctx, eventId, userId, 'chat.unlinked', 'user', userId, `Unlinked a ${link.transport} chat account.`);
}

// ---------- inbound ----------

export const InboundSchema = z.object({
  eventId: z.string().regex(/^evt-[a-z0-9-]{1,60}$/),
  externalUserId: z.string().trim().min(1).max(128),
  messageId: z.string().trim().min(1).max(128),
  text: z.string().trim().min(1).max(MAX_MESSAGE_LENGTH),
});

export interface InboundResult {
  reply: string;
  /** True when the chat account is linked to a HELLO person. */
  linked: boolean;
  /** True when this message id was handled before; the stored reply is returned and nothing runs again. */
  replayed: boolean;
  /** True when an identical message is still being handled. The sender should retry shortly. */
  inProgress: boolean;
}

const NOT_LINKED_REPLY =
  'This chat is not linked to a HELLO account yet. In HELLO, open Settings, choose "Link a chat app", and send the code here as: LINK <code>';
const BAD_CODE_REPLY = 'That code is not valid or has expired. Create a new one in HELLO under Settings, then send LINK <code>.';

export async function receiveInbound(ctx: ServiceContext, transport: string, raw: z.infer<typeof InboundSchema>): Promise<InboundResult> {
  const parsed = InboundSchema.safeParse(raw);
  if (!parsed.success) throw new DomainError('VALIDATION_FAILED', 'The inbound message is malformed.');
  const input = parsed.data;
  const id = `${transport}:${input.messageId}`;
  const now = ctx.now();

  // Claim the message id first, so a duplicate arriving at the same moment cannot run it a second time.
  const claim: ChatInbound = { id, transport, state: 'PROCESSING', userId: null, reply: '', receivedAt: now };
  if (!(await ctx.store.docPutIfAbsent('chatInbound', claim))) {
    const seen = await ctx.store.docGet('chatInbound', id);
    if (seen?.state === 'DONE') return { reply: seen.reply, linked: seen.userId !== null, replayed: true, inProgress: false };
    return { reply: '', linked: false, replayed: true, inProgress: true };
  }

  try {
    const { reply, userId } = await handleInbound(ctx, transport, input);
    await ctx.store.docMutate('chatInbound', id, (doc) => ({ ...doc, state: 'DONE', userId, reply }));
    return { reply, linked: userId !== null, replayed: false, inProgress: false };
  } catch (error: unknown) {
    // Nothing was recorded as done, so the sender's retry can run it.
    await ctx.store.docDelete('chatInbound', id);
    throw error;
  }
}

async function handleInbound(ctx: ServiceContext, transport: string, input: z.infer<typeof InboundSchema>): Promise<{ reply: string; userId: string | null }> {
  const linkId = `${transport}:${input.externalUserId}`;
  const command = /^link\s+([a-z0-9]{8})$/i.exec(input.text);
  if (command?.[1]) {
    const codeId = sha(command[1].toUpperCase());
    const code = await ctx.store.docGet('chatLinkCodes', codeId);
    // Deleting the code is the claim: of two simultaneous uses, only one deletes it.
    if (!code || code.expiresAt <= ctx.now() || code.eventId !== input.eventId || !(await ctx.store.docDelete('chatLinkCodes', codeId))) {
      return { reply: BAD_CODE_REPLY, userId: null };
    }
    const link: ChatLink = { id: linkId, transport, externalUserId: input.externalUserId, userId: code.userId, eventId: input.eventId, createdAt: ctx.now() };
    await ctx.store.docPut('chatLinks', link);
    await audit(ctx, input.eventId, code.userId, 'chat.linked', 'user', code.userId, `Linked a ${transport} chat account.`);
    const user = await ctx.store.getUser(code.userId);
    return {
      reply: `Linked to ${user?.displayName ?? 'your HELLO account'}. HELLO will send your notifications here, and you can message HELLO from this chat. Unlink any time in Settings.`,
      userId: code.userId,
    };
  }

  const link = await ctx.store.docGet('chatLinks', linkId);
  if (!link || link.eventId !== input.eventId) return { reply: NOT_LINKED_REPLY, userId: null };
  // The same per-person limit as messages typed in the app.
  consumeAction('message.send', link.userId, input.eventId, ctx.now());
  const result = await handleMessage(ctx, { eventId: input.eventId, userId: link.userId, text: input.text });
  return { reply: result.reply, userId: link.userId };
}

// ---------- outbound ----------

/** Queues a notification for every chat account the recipient linked on this transport. */
export async function enqueueNotification(ctx: ServiceContext, transport: ChatTransport, notification: Notification): Promise<number> {
  if (!transport.external) return 0;
  const links = await ctx.store.docList('chatLinks', { userId: notification.recipientUserId, eventId: notification.eventId, transport: transport.name });
  const now = ctx.now();
  let queued = 0;
  for (const link of links) {
    const delivery: ChatDelivery = {
      // Derived from the notification and the link, so the same notification is never queued twice.
      id: `dlv_${sha(`${notification.id}:${link.id}`).slice(0, 24)}`,
      eventId: notification.eventId,
      recipientUserId: notification.recipientUserId,
      transport: transport.name,
      externalUserId: link.externalUserId,
      body: notification.body,
      href: notification.href,
      createdAt: now,
      status: 'PENDING',
      attempts: 0,
      nextAttemptAt: now,
      leaseUntil: null,
      lastError: null,
      deliveredAt: null,
      reference: null,
    };
    if (await ctx.store.docPutIfAbsent('chatDeliveries', delivery)) queued += 1;
  }
  return queued;
}

/** 5 s, 10 s, 20 s, … capped at 10 minutes. */
export function backoffMs(attempts: number): number {
  return Math.min(10 * 60_000, 5_000 * 2 ** Math.max(0, attempts - 1));
}

export interface ProcessResult {
  delivered: number;
  retrying: number;
  failed: number;
}

/**
 * Sends due deliveries. Safe to run on several instances at once: a delivery is claimed (PENDING → SENDING
 * with a lease) by one worker only, and a delivery whose worker died is taken over when its lease runs out.
 */
export async function processDeliveries(ctx: ServiceContext, transport: ChatTransport, limit = 25): Promise<ProcessResult> {
  const out: ProcessResult = { delivered: 0, retrying: 0, failed: 0 };
  if (!transport.external) return out;
  const now = ctx.now();
  const candidates = [
    ...(await ctx.store.docList('chatDeliveries', { status: 'PENDING', transport: transport.name })),
    ...(await ctx.store.docList('chatDeliveries', { status: 'SENDING', transport: transport.name })),
  ];
  const isFree = (d: ChatDelivery) => (d.status === 'PENDING' && d.nextAttemptAt <= now) || (d.status === 'SENDING' && (d.leaseUntil ?? 0) <= now);
  const due = candidates.filter(isFree).sort((a, b) => a.nextAttemptAt - b.nextAttemptAt).slice(0, limit);

  for (const d of due) {
    const claimed = await ctx.store.docMutate('chatDeliveries', d.id, (cur) => (isFree(cur) ? { ...cur, status: 'SENDING', leaseUntil: now + DELIVERY_LEASE_MS, attempts: cur.attempts + 1 } : null));
    if (!claimed) continue;
    let result: DeliveryResult;
    try {
      result = await transport.deliver({ id: claimed.id, eventId: claimed.eventId, externalUserId: claimed.externalUserId, body: claimed.body, href: claimed.href, createdAt: claimed.createdAt });
    } catch {
      result = { ok: false, retryable: true, reason: 'The transport failed unexpectedly.' };
    }
    const at = ctx.now();
    const settled = await ctx.store.docMutate('chatDeliveries', claimed.id, (cur) => {
      if (cur.status !== 'SENDING') return null;
      if (result.ok) return { ...cur, status: 'DELIVERED', deliveredAt: at, leaseUntil: null, lastError: null, reference: result.reference };
      if (!result.retryable || cur.attempts >= MAX_DELIVERY_ATTEMPTS) return { ...cur, status: 'FAILED', leaseUntil: null, lastError: result.reason };
      return { ...cur, status: 'PENDING', leaseUntil: null, lastError: result.reason, nextAttemptAt: at + backoffMs(cur.attempts) };
    });
    if (settled?.status === 'DELIVERED') out.delivered += 1;
    else if (settled?.status === 'FAILED') out.failed += 1;
    else if (settled?.status === 'PENDING') out.retrying += 1;
  }
  return out;
}

// ---------- status ----------

export interface GatewayStatus {
  transport: { name: string } & TransportStatus;
  links: ChatLinkView[];
  /** Delivery totals for the event: organisers only. */
  deliveries: { pending: number; delivered: number; failed: number } | null;
}

export async function gatewayStatus(ctx: ServiceContext, eventId: string, userId: string, transport: ChatTransport): Promise<GatewayStatus> {
  const membership = await requireCapability(ctx, eventId, userId, 'event.read');
  let deliveries: GatewayStatus['deliveries'] = null;
  if (roleHasCapability(membership.role, 'audit.read')) {
    const all = await ctx.store.docList('chatDeliveries', { eventId });
    deliveries = {
      pending: all.filter((d) => d.status === 'PENDING' || d.status === 'SENDING').length,
      delivered: all.filter((d) => d.status === 'DELIVERED').length,
      failed: all.filter((d) => d.status === 'FAILED').length,
    };
  }
  return { transport: { name: transport.name, ...transport.describe() }, links: await listChatLinks(ctx, eventId, userId), deliveries };
}
