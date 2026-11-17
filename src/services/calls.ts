import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { DomainError } from '../domain/errors';
import type { CallRoom } from '../domain/product';
import { notify, requireCapability, type ServiceContext } from './context';
import { ID } from './feed';

/**
 * Video calls. Audio and video travel directly between browsers (WebRTC); the server only relays
 * the short setup messages each pair of browsers needs to find each other, and only between two
 * people who are both in the same call. It never receives media.
 */

export const CALL_MAX_PEOPLE = 8;
const STALE_MS = 15_000;
const peer = z.string().regex(/^[a-f0-9]{16}$/);

export const CallCreateSchema = z.object({
  title: z.string().trim().min(3).max(80),
  communityId: z.string().regex(ID).nullable().default(null),
});

export const CallActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('join') }),
  z.object({ action: z.literal('leave'), peerId: peer }),
  z.object({ action: z.literal('end') }),
  z.object({
    action: z.literal('signal'),
    peerId: peer,
    to: peer,
    data: z.discriminatedUnion('type', [
      z.object({ type: z.enum(['offer', 'answer']), sdp: z.string().max(60_000) }),
      z.object({ type: z.literal('ice'), candidate: z.string().max(2_000), sdpMid: z.string().max(64).nullable(), sdpMLineIndex: z.number().int().min(0).max(64).nullable() }),
    ]),
  }),
]);

export const CallPollSchema = z.object({ peerId: peer, since: z.coerce.number().int().nonnegative() });

async function eventCall(ctx: ServiceContext, eventId: string, callId: string): Promise<CallRoom> {
  const call = ID.test(callId) ? await ctx.store.docGet('calls', callId) : null;
  if (!call || call.eventId !== eventId) throw new DomainError('NOT_FOUND', 'That call does not exist.');
  return call;
}

const live = (call: CallRoom, now: number) => call.participants.filter((p) => now - p.seenAt < STALE_MS);

export async function startCall(ctx: ServiceContext, eventId: string, userId: string, input: z.infer<typeof CallCreateSchema>): Promise<CallRoom> {
  await requireCapability(ctx, eventId, userId, 'message.send');
  let invite: string[] = [];
  if (input.communityId) {
    const community = await ctx.store.docGet('communities', input.communityId);
    if (!community || community.eventId !== eventId) throw new DomainError('NOT_FOUND', 'That community does not exist.');
    if (!community.memberIds.includes(userId)) throw new DomainError('FORBIDDEN', 'Join the community to start a call in it.');
    invite = community.memberIds.filter((m) => m !== userId);
  }
  const call: CallRoom = { id: ctx.newId('call'), eventId, title: input.title, hostId: userId, communityId: input.communityId, createdAt: ctx.now(), endedAt: null, participants: [], signals: [], seq: 0 };
  await ctx.store.docPut('calls', call);
  const host = await ctx.store.getUser(userId);
  for (const recipientUserId of invite) {
    await notify(ctx, { eventId, recipientUserId, kind: 'CALL_STARTED', body: `${host?.displayName ?? 'Someone'} started a call: ${call.title}`, href: `/events/${eventId}/calls/${call.id}`, dedupeParts: [call.id] });
  }
  return call;
}

export async function listCalls(ctx: ServiceContext, eventId: string, userId: string) {
  await requireCapability(ctx, eventId, userId, 'event.read');
  const now = ctx.now();
  const calls = (await ctx.store.docList('calls', { eventId })).filter((c) => c.endedAt === null).sort((a, b) => b.createdAt - a.createdAt);
  return Promise.all(
    calls.map(async (c) => ({
      id: c.id,
      title: c.title,
      host: (await ctx.store.getUser(c.hostId))?.displayName ?? 'Someone',
      isHost: c.hostId === userId,
      people: live(c, now).length,
      createdAt: c.createdAt,
    })),
  );
}

export async function getCall(ctx: ServiceContext, eventId: string, userId: string, callId: string) {
  await requireCapability(ctx, eventId, userId, 'event.read');
  const call = await eventCall(ctx, eventId, callId);
  return { id: call.id, title: call.title, ended: call.endedAt !== null, isHost: call.hostId === userId };
}

export async function actOnCall(ctx: ServiceContext, eventId: string, userId: string, callId: string, input: z.infer<typeof CallActionSchema>) {
  await requireCapability(ctx, eventId, userId, 'message.send');
  const call = await eventCall(ctx, eventId, callId);
  const now = ctx.now();
  if (input.action === 'end') {
    if (call.hostId !== userId) throw new DomainError('FORBIDDEN', 'Only the person who started the call can end it for everyone.');
    await ctx.store.docMutate('calls', call.id, (c) => ({ ...c, endedAt: now, participants: [], signals: [] }));
    return { ended: true };
  }
  if (call.endedAt !== null) throw new DomainError('INVALID_TRANSITION', 'This call has ended.');
  if (input.action === 'join') {
    const peerId = randomBytes(8).toString('hex');
    const updated = await ctx.store.docMutate('calls', call.id, (c) => {
      const present = live(c, now);
      return present.length >= CALL_MAX_PEOPLE ? null : { ...c, participants: [...present, { userId, peerId, joinedAt: now, seenAt: now }] };
    });
    if (!updated) throw new DomainError('INELIGIBLE', `This call is full (${CALL_MAX_PEOPLE} people).`);
    return { peerId, peers: updated.participants.filter((p) => p.peerId !== peerId).map((p) => p.peerId), iceServers: iceServers() };
  }
  // From here on the caller must own the peer id they speak for.
  if (!call.participants.some((p) => p.peerId === input.peerId && p.userId === userId)) throw new DomainError('FORBIDDEN', 'You are not in this call.');
  if (input.action === 'leave') {
    await ctx.store.docMutate('calls', call.id, (c) => ({ ...c, participants: c.participants.filter((p) => p.peerId !== input.peerId), signals: c.signals.filter((s) => s.to !== input.peerId) }));
    return { left: true };
  }
  if (!call.participants.some((p) => p.peerId === input.to)) return { sent: false };
  await ctx.store.docMutate('calls', call.id, (c) => {
    const seq = c.seq + 1;
    // The sender is set here, from the session, not taken from the request.
    return { ...c, seq, signals: [...c.signals, { seq, to: input.to, from: input.peerId, data: JSON.stringify(input.data) }].slice(-600) };
  });
  return { sent: true };
}

/** One poll: marks the caller present, drops people who vanished, and hands over the setup messages addressed to the caller. */
export async function pollCall(ctx: ServiceContext, eventId: string, userId: string, callId: string, input: z.infer<typeof CallPollSchema>) {
  await requireCapability(ctx, eventId, userId, 'event.read');
  const call = await eventCall(ctx, eventId, callId);
  if (call.endedAt !== null) return { ended: true, peers: [], signals: [] };
  if (!call.participants.some((p) => p.peerId === input.peerId && p.userId === userId)) throw new DomainError('FORBIDDEN', 'You are not in this call.');
  const now = ctx.now();
  let mine: CallRoom['signals'] = [];
  const updated = await ctx.store.docMutate('calls', call.id, (c) => {
    const participants = c.participants.map((p) => (p.peerId === input.peerId ? { ...p, seenAt: now } : p)).filter((p) => now - p.seenAt < STALE_MS);
    mine = c.signals.filter((s) => s.to === input.peerId && s.seq > input.since);
    const present = new Set(participants.map((p) => p.peerId));
    // Delivered messages, and messages for people who left, are dropped.
    return { ...c, participants, signals: c.signals.filter((s) => present.has(s.to) && !(s.to === input.peerId && s.seq <= input.since)) };
  });
  const peers = await Promise.all(
    (updated?.participants ?? []).map(async (p) => ({ peerId: p.peerId, name: (await ctx.store.getUser(p.userId))?.displayName ?? 'Someone', isSelf: p.peerId === input.peerId })),
  );
  return { ended: false, peers, signals: mine.map((s) => ({ seq: s.seq, from: s.from, data: JSON.parse(s.data) as unknown })) };
}

const IceSchema = z.array(z.object({ urls: z.union([z.string(), z.array(z.string())]), username: z.string().optional(), credential: z.string().optional() })).max(6);

/**
 * STUN/TURN servers from HELLO_ICE_SERVERS (JSON). Without them, calls connect on the same network
 * only, and the app contacts nobody else. They are handed only to people who have joined a call.
 */
export function iceServers(): z.infer<typeof IceSchema> {
  try {
    const parsed = IceSchema.safeParse(JSON.parse(process.env.HELLO_ICE_SERVERS ?? '[]'));
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}
