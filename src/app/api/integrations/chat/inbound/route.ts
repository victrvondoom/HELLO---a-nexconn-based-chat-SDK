import { NextResponse } from 'next/server';
import { DomainError } from '@/domain/errors';
import { errorResponse, jsonError, jsonOk } from '@/lib/http';
import { getRuntime } from '@/lib/runtime';
import { FixedWindowRateLimiter } from '@/lib/rate-limit';
import { SIGNATURE_HEADER, TIMESTAMP_HEADER, verify } from '@/integrations/chat/signature';
import { InboundSchema, receiveInbound } from '@/services/chat-gateway';

/**
 * Messages from the chat network (for Nexconn: the bridge forwards each user message here).
 *
 * Authentication is the HMAC signature (src/integrations/chat/signature.ts), not a session cookie: the
 * caller is a server. The endpoint does not exist unless a chat transport is configured. Each message id is
 * handled once, so the bridge can safely retry.
 */
const MAX_BODY = 16 * 1024;
const perAccount = new FixedWindowRateLimiter(30, 60_000, 'Too many messages from this chat account. Wait a moment.');

export async function POST(request: Request): Promise<Response> {
  const { ctx, chat } = await getRuntime();
  const secret = (process.env.HELLO_CHAT_SECRET ?? '').trim();
  if (!chat.external || !secret) return jsonError('DISABLED', 'No chat network is connected to this HELLO.', 404);
  try {
    const raw = await request.text();
    if (raw.length > MAX_BODY) throw new DomainError('VALIDATION_FAILED', 'Request too large.');
    const check = verify(secret, request.headers.get(SIGNATURE_HEADER), request.headers.get(TIMESTAMP_HEADER), raw, Date.now());
    if (!check.ok) return jsonError('UNAUTHENTICATED', check.reason === 'STALE' ? 'The request is too old or from the future.' : 'The signature does not match.', 401);
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      throw new DomainError('VALIDATION_FAILED', 'The request body must be JSON.');
    }
    const input = InboundSchema.safeParse(body);
    if (!input.success) throw new DomainError('VALIDATION_FAILED', 'Send eventId, externalUserId, messageId and text.');
    perAccount.consume(`${chat.name}:${input.data.externalUserId}`, ctx.now());
    const result = await receiveInbound(ctx, chat.name, input.data);
    // 202 tells the bridge an identical message is still running: retry later for the reply.
    if (result.inProgress) return NextResponse.json({ ok: true, data: result }, { status: 202 });
    return jsonOk(result);
  } catch (error: unknown) {
    return errorResponse(error, 'chat.inbound');
  }
}
