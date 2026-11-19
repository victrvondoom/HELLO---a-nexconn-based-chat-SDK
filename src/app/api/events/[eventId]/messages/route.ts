import type { NextResponse } from 'next/server';
import { currentUserId } from '@/lib/session';
import { errorResponse, jsonError, jsonOk, readJson } from '@/lib/http';
import { getRuntime } from '@/lib/runtime';
import { SendMessageBody } from '@/lib/validation/api';
import { consumeAction } from '@/lib/action-limits';
import { handleMessage } from '@/services/pipeline';
import { handleMessageOnce } from '@/services/chat-gateway';

export async function POST(
  request: Request,
  context: { params: Promise<{ eventId: string }> },
): Promise<NextResponse> {
  const userId = await currentUserId();
  if (!userId) {
    return jsonError('UNAUTHENTICATED', 'Sign in to continue.', 401);
  }
  const { eventId } = await context.params;
  try {
    const parsed = SendMessageBody.safeParse(await readJson(request));
    if (!parsed.success) {
      return jsonError('VALIDATION_FAILED', 'Write a message between 1 and 2000 characters.', 422);
    }
    const runtime = await getRuntime();
    // Shared with the MCP tool that sends messages (src/lib/action-limits.ts).
    consumeAction('message.send', userId, eventId, runtime.ctx.now());
    const { text, clientId } = parsed.data;
    if (clientId) {
      const once = await handleMessageOnce(runtime.ctx, { eventId, userId, text, clientId });
      // Already handled (a resend from the outbox): the message is in the record, nothing runs again.
      return once ? jsonOk(once, 201) : jsonOk({ replayed: true }, 200);
    }
    const result = await handleMessage(runtime.ctx, { eventId, userId, text });
    return jsonOk(result, 201);
  } catch (error: unknown) {
    return errorResponse(error, 'messages.create');
  }
}
