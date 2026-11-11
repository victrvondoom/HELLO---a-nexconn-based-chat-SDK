import { z } from 'zod';
import { viewerRoute } from '@/lib/api-handler';
import { jsonError, jsonOk, readJson } from '@/lib/http';
import { getRuntime } from '@/lib/runtime';
import { FixedWindowRateLimiter } from '@/lib/rate-limit';
import { follow, unfollow } from '@/services/social';

const Body = z.object({ follow: z.boolean() });
/** 60 follow changes a minute is plenty for a person and too few for a script working through an event. */
const limiter = new FixedWindowRateLimiter(60, 60_000);

export const POST = viewerRoute<{ eventId: string; userId: string }>('people.follow', async ({ userId, params, request }) => {
  const parsed = Body.safeParse(await readJson(request));
  if (!parsed.success) return jsonError('VALIDATION_FAILED', 'Say whether to follow or unfollow.', 422);
  const { ctx } = await getRuntime();
  limiter.consume(`follow:${userId}`, ctx.now());
  const rel = parsed.data.follow
    ? await follow(ctx, params.eventId, userId, params.userId)
    : await unfollow(ctx, params.eventId, userId, params.userId);
  return jsonOk(rel);
});
