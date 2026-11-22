import { z } from 'zod';
import { viewerRoute } from '@/lib/api-handler';
import { jsonOk, parseBody } from '@/lib/http';
import { getRuntime } from '@/lib/runtime';
import { setRoomFull } from '@/services/live-room';

export const POST = viewerRoute<{ eventId: string; sessionId: string }>('now.full', async ({ userId, params, request }) => {
  const input = await parseBody(request, z.object({ closed: z.boolean() }), 'Say whether the room is full.');
  const { ctx } = await getRuntime();
  await setRoomFull(ctx, params.eventId, userId, params.sessionId, input.closed);
  return jsonOk({ closed: input.closed });
});

export const dynamic = 'force-dynamic';
