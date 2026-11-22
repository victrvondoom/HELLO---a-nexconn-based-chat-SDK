import { viewerRoute } from '@/lib/api-handler';
import { jsonOk, readJson } from '@/lib/http';
import { getRuntime } from '@/lib/runtime';
import { FixedWindowRateLimiter } from '@/lib/rate-limit';
import { draftPayment, listPayments } from '@/services/payments';

const limiter = new FixedWindowRateLimiter(10, 60_000);

export const GET = viewerRoute<{ eventId: string; peerId: string }>('pay.list', async ({ userId, params }) => {
  const { ctx } = await getRuntime();
  return jsonOk(await listPayments(ctx, params.eventId, userId, params.peerId));
});

export const POST = viewerRoute<{ eventId: string; peerId: string }>('pay.draft', async ({ userId, params, request }) => {
  const { ctx } = await getRuntime();
  limiter.consume(`pay:${userId}`, ctx.now());
  return jsonOk(await draftPayment(ctx, params.eventId, userId, params.peerId, await readJson(request)), 201);
});

export const dynamic = 'force-dynamic';
