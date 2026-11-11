import { viewerRoute } from '@/lib/api-handler';
import { jsonOk, readJson } from '@/lib/http';
import { getRuntime } from '@/lib/runtime';
import { FixedWindowRateLimiter } from '@/lib/rate-limit';
import { getThread, sendSealed } from '@/services/private-messages';

const limiter = new FixedWindowRateLimiter(30, 60_000);

export const GET = viewerRoute<{ eventId: string; peerId: string }>('dm.read', async ({ userId, params }) => {
  const { ctx } = await getRuntime();
  return jsonOk(await getThread(ctx, params.eventId, userId, params.peerId));
});

export const POST = viewerRoute<{ eventId: string; peerId: string }>('dm.send', async ({ userId, params, request }) => {
  const { ctx } = await getRuntime();
  limiter.consume(`dm:${userId}`, ctx.now());
  const message = await sendSealed(ctx, params.eventId, userId, params.peerId, await readJson(request));
  return jsonOk(message, 201);
});
