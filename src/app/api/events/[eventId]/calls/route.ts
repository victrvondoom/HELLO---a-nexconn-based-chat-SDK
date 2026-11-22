import { viewerRoute } from '@/lib/api-handler';
import { jsonOk, parseBody } from '@/lib/http';
import { getRuntime } from '@/lib/runtime';
import { FixedWindowRateLimiter } from '@/lib/rate-limit';
import { CallCreateSchema, listCalls, startCall } from '@/services/calls';

const limiter = new FixedWindowRateLimiter(6, 60_000);

export const GET = viewerRoute<{ eventId: string }>('calls.list', async ({ userId, params }) => {
  const { ctx } = await getRuntime();
  return jsonOk({ calls: await listCalls(ctx, params.eventId, userId) });
});

export const POST = viewerRoute<{ eventId: string }>('calls.create', async ({ userId, params, request }) => {
  const input = await parseBody(request, CallCreateSchema, 'Give the call a name of 3 to 80 characters.');
  const { ctx } = await getRuntime();
  limiter.consume(`call:${userId}`, ctx.now());
  const call = await startCall(ctx, params.eventId, userId, input);
  return jsonOk({ id: call.id }, 201);
});

export const dynamic = 'force-dynamic';
