import { viewerRoute } from '@/lib/api-handler';
import { jsonOk } from '@/lib/http';
import { getRuntime } from '@/lib/runtime';
import { consumeAction } from '@/lib/action-limits';
import { holdSeat, releaseSeat } from '@/services/live-room';

/** Hold a seat. Confirmed only when this returns 200: the server checks and reserves in one step. */
export const POST = viewerRoute<{ eventId: string; sessionId: string }>('now.hold', async ({ userId, params }) => {
  const { ctx } = await getRuntime();
  consumeAction('live.action', userId, params.eventId, ctx.now());
  return jsonOk(await holdSeat(ctx, params.eventId, userId, params.sessionId));
});

export const DELETE = viewerRoute<{ eventId: string; sessionId: string }>('now.release', async ({ userId, params }) => {
  const { ctx } = await getRuntime();
  await releaseSeat(ctx, params.eventId, userId, params.sessionId);
  return jsonOk({ released: true });
});

export const dynamic = 'force-dynamic';
