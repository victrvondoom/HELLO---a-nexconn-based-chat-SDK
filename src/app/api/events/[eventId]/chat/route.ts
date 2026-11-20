import { z } from 'zod';
import { viewerRoute } from '@/lib/api-handler';
import { jsonOk, parseBody } from '@/lib/http';
import { getRuntime } from '@/lib/runtime';
import { createLinkCode, gatewayStatus, unlinkChat } from '@/services/chat-gateway';

/** The person's chat links, the transport's state, and (for organisers) delivery totals. */
export const GET = viewerRoute<{ eventId: string }>('chat.status', async ({ userId, params }) => {
  const { ctx, chat } = await getRuntime();
  return jsonOk(await gatewayStatus(ctx, params.eventId, userId, chat));
});

const ActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('code') }),
  z.object({ action: z.literal('unlink'), linkId: z.string().min(3).max(200) }),
]);

export const POST = viewerRoute<{ eventId: string }>('chat.action', async ({ userId, params, request }) => {
  const input = await parseBody(request, ActionSchema, 'Choose an action.');
  const { ctx } = await getRuntime();
  if (input.action === 'code') return jsonOk(await createLinkCode(ctx, params.eventId, userId), 201);
  await unlinkChat(ctx, params.eventId, userId, input.linkId);
  return jsonOk({ unlinked: true });
});
