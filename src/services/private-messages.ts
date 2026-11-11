import { createHash } from 'node:crypto';
import { z } from 'zod';
import { DomainError } from '../domain/errors';
import type { KeyBundle, SealedMessage } from '../domain/types';
import { notify, requireCapability, type ServiceContext } from './context';

/**
 * The relay for end-to-end encrypted private messages.
 *
 * What the server can do: check that both people are connected (a mutual follow), that the keys
 * named belong to them, and that the payload is well-formed and small; then store and relay it.
 * What it cannot do: read it. It never sees a private key or a plaintext, and its notifications
 * say only that a message arrived, never what it says.
 */

const B64URL = /^[A-Za-z0-9_-]+$/;

export const PublicKeySchema = z.object({
  kty: z.literal('EC'),
  crv: z.literal('P-256'),
  // A P-256 coordinate is 32 bytes: 43 base64url characters.
  x: z.string().regex(B64URL).length(43),
  y: z.string().regex(B64URL).length(43),
});

export const SealedBodySchema = z.object({
  senderKeyId: z.string().regex(/^key_[0-9a-f]{20}$/),
  recipientKeyId: z.string().regex(/^key_[0-9a-f]{20}$/),
  // 12-byte IV is 16 base64url characters.
  iv: z.string().regex(B64URL).length(16),
  // At most ~6 KB of ciphertext: enough for 4,000 characters of text plus the GCM tag.
  ciphertext: z.string().regex(B64URL).min(22).max(8200),
});

const MAX_KEYS_PER_PERSON = 8;

/** Same algorithm as the browser (src/lib/e2ee/crypto.ts), so the server can check a key id honestly. */
function fingerprint(jwk: z.infer<typeof PublicKeySchema>): string {
  return createHash('sha256').update(`${jwk.crv}.${jwk.x}.${jwk.y}`).digest('hex');
}

export async function publishKey(ctx: ServiceContext, userId: string, raw: unknown): Promise<KeyBundle> {
  const parsed = PublicKeySchema.safeParse(raw);
  if (!parsed.success) throw new DomainError('VALIDATION_FAILED', 'That is not a P-256 public key.');
  const fp = fingerprint(parsed.data);
  const id = `key_${fp.slice(0, 20)}`;
  const existing = await ctx.store.listKeyBundles(userId);
  const same = existing.find((k) => k.id === id);
  if (same) return same;
  if (existing.length >= MAX_KEYS_PER_PERSON) {
    throw new DomainError('VALIDATION_FAILED', 'You have published keys from too many devices. Erase your data to start again.');
  }
  const bundle: KeyBundle = { id, userId, publicKey: parsed.data, fingerprint: fp, createdAt: ctx.now() };
  await ctx.store.putKeyBundle(bundle);
  return bundle;
}

async function connected(ctx: ServiceContext, a: string, b: string): Promise<boolean> {
  const [aFollows, bFollows] = await Promise.all([ctx.store.listFollowing(a), ctx.store.listFollowing(b)]);
  return aFollows.some((f) => f.followeeId === b) && bFollows.some((f) => f.followeeId === a);
}

async function requireConnection(ctx: ServiceContext, eventId: string, viewerId: string, peerId: string): Promise<void> {
  await requireCapability(ctx, eventId, viewerId, 'event.read');
  if (viewerId === peerId) throw new DomainError('VALIDATION_FAILED', 'You cannot message yourself.');
  const peer = await ctx.store.findMembership(eventId, peerId);
  if (!peer) throw new DomainError('NOT_FOUND', 'That person is not part of this event.');
  if (!(await connected(ctx, viewerId, peerId))) {
    throw new DomainError('FORBIDDEN', 'Private messages open once you follow each other.');
  }
}

export interface ThreadData {
  myKeys: KeyBundle[];
  peerKeys: KeyBundle[];
  messages: SealedMessage[];
}

export async function getThread(ctx: ServiceContext, eventId: string, viewerId: string, peerId: string): Promise<ThreadData> {
  await requireConnection(ctx, eventId, viewerId, peerId);
  const [myKeys, peerKeys, messages] = await Promise.all([
    ctx.store.listKeyBundles(viewerId),
    ctx.store.listKeyBundles(peerId),
    ctx.store.listSealedBetween(viewerId, peerId),
  ]);
  return { myKeys, peerKeys, messages: messages.slice(-200) };
}

export async function sendSealed(
  ctx: ServiceContext,
  eventId: string,
  senderId: string,
  recipientId: string,
  raw: unknown,
): Promise<SealedMessage> {
  await requireConnection(ctx, eventId, senderId, recipientId);
  const parsed = SealedBodySchema.safeParse(raw);
  if (!parsed.success) throw new DomainError('VALIDATION_FAILED', 'The encrypted message is malformed.');
  const [mine, theirs] = await Promise.all([ctx.store.listKeyBundles(senderId), ctx.store.listKeyBundles(recipientId)]);
  if (!mine.some((k) => k.id === parsed.data.senderKeyId)) throw new DomainError('VALIDATION_FAILED', 'Your device key is not published.');
  if (!theirs.some((k) => k.id === parsed.data.recipientKeyId)) throw new DomainError('VALIDATION_FAILED', 'That key does not belong to the recipient.');
  const message: SealedMessage = { id: ctx.newId('dm'), senderId, recipientId, ...parsed.data, createdAt: ctx.now() };
  await ctx.store.insertSealedMessage(message);
  const sender = await ctx.store.getUser(senderId);
  // The notification carries no content. The server has none to give.
  await notify(ctx, {
    eventId,
    recipientUserId: recipientId,
    kind: 'PRIVATE_MESSAGE',
    body: `New private message from ${sender?.displayName ?? 'a connection'}. Open it on your device to read it.`,
    href: `/events/${eventId}/messages/${senderId}`,
    dedupeParts: [message.id],
  });
  return message;
}

export interface InboxRow {
  peerId: string;
  displayName: string;
  lastAt: number | null;
  count: number;
}

/** Connections, with the time of the last private message. Contents are never read. */
export async function inbox(ctx: ServiceContext, eventId: string, viewerId: string): Promise<InboxRow[]> {
  await requireCapability(ctx, eventId, viewerId, 'event.read');
  const [following, followers, sealed] = await Promise.all([
    ctx.store.listFollowing(viewerId),
    ctx.store.listFollowers(viewerId),
    ctx.store.listSealedInvolving(viewerId),
  ]);
  const back = new Set(followers.map((f) => f.followerId));
  const rows: InboxRow[] = [];
  for (const f of following) {
    if (!back.has(f.followeeId)) continue;
    if (!(await ctx.store.findMembership(eventId, f.followeeId))) continue;
    const user = await ctx.store.getUser(f.followeeId);
    const mine = sealed.filter((m) => m.senderId === f.followeeId || m.recipientId === f.followeeId);
    rows.push({
      peerId: f.followeeId,
      displayName: user?.displayName ?? 'Unknown',
      lastAt: mine.length > 0 ? Math.max(...mine.map((m) => m.createdAt)) : null,
      count: mine.length,
    });
  }
  return rows.sort((a, b) => (b.lastAt ?? 0) - (a.lastAt ?? 0) || a.displayName.localeCompare(b.displayName));
}
