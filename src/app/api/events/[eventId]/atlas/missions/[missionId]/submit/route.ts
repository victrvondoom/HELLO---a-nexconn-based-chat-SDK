import { viewerRoute } from '@/lib/api-handler';
import { jsonOk, parseBody } from '@/lib/http';
import { getRuntime } from '@/lib/runtime';
import { FixedWindowRateLimiter } from '@/lib/rate-limit';
import { SubmitSchema, submitMission } from '@/services/field-atlas';

/** Ten submissions a minute per person is far more than a real attempt needs, and stops code guessing. */
const limiter = new FixedWindowRateLimiter(10, 60_000, 'Too many submissions in a minute. Wait a moment, then try again.');

export const POST = viewerRoute<{ eventId: string; missionId: string }>('atlas.submit', async ({ userId, params, request }) => {
  const input = await parseBody(request, SubmitSchema, 'Check the evidence you entered.');
  const { ctx } = await getRuntime();
  limiter.consume(`atlas:${userId}`, ctx.now());
  return jsonOk(await submitMission(ctx, params.eventId, userId, params.missionId, input));
});
