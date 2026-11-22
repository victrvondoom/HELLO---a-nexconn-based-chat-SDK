import { viewerRoute } from '@/lib/api-handler';
import { jsonError, jsonOk, readJson } from '@/lib/http';
import { getRuntime } from '@/lib/runtime';
import { FixedWindowRateLimiter } from '@/lib/rate-limit';
import { PaymentActionBody, cancelPayment, confirmPayment } from '@/services/payments';

const limiter = new FixedWindowRateLimiter(10, 60_000);

export const POST = viewerRoute<{ eventId: string; paymentId: string }>('pay.decide', async ({ userId, params, request }) => {
  const parsed = PaymentActionBody.safeParse(await readJson(request));
  if (!parsed.success) return jsonError('VALIDATION_FAILED', 'Choose confirm or cancel.', 422);
  const { ctx } = await getRuntime();
  limiter.consume(`pay-decide:${userId}`, ctx.now());
  const { action, expectedVersion } = parsed.data;
  const run = action === 'confirm' ? confirmPayment : cancelPayment;
  return jsonOk(await run(ctx, params.eventId, userId, params.paymentId, expectedVersion));
});

export const dynamic = 'force-dynamic';
