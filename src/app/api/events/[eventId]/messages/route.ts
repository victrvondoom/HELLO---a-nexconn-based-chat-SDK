import type { NextResponse } from 'next/server';
import { currentUserId } from '@/lib/session';
import { errorResponse, jsonError, jsonOk, readJson } from '@/lib/http';
import { getRuntime } from '@/lib/runtime';
import { SendMessageBody } from '@/lib/validation/api';
import { FixedWindowRateLimiter } from '@/lib/rate-limit';
import { handleMessage } from '@/services/pipeline';

/** 20 messages per minute per viewer. Enough for a conversation, not enough to flood operations. */
const limiter = new FixedWindowRateLimiter(20, 60_000);

export async function POST(
  request: Request,
  context: { params: Promise<{ eventId: string }> },
): Promise<NextResponse> {
  const userId = await currentUserId();
  if (!userId) {
    return jsonError('UNAUTHENTICATED', 'Choose a demo account to continue.', 401);
  }
  const { eventId } = await context.params;
  try {
    const parsed = SendMessageBody.safeParse(await readJson(request));
    if (!parsed.success) {
      return jsonError('VALIDATION_FAILED', 'Write a message between 1 and 2000 characters.', 422);
    }
    const runtime = await getRuntime();
    limiter.consume(`${userId}:${eventId}`, runtime.ctx.now());
    const result = await handleMessage(runtime.ctx, { eventId, userId, text: parsed.data.text });
    return jsonOk(result, 201);
  } catch (error: unknown) {
    return errorResponse(error, 'messages.create');
  }
}
