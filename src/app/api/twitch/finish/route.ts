import { z } from 'zod';
import { viewerRoute } from '@/lib/api-handler';
import { jsonOk, parseBody } from '@/lib/http';
import { getRuntime } from '@/lib/runtime';
import { FixedWindowRateLimiter } from '@/lib/rate-limit';
import { finishTwitch } from '@/services/privacy-twitch';

const limiter = new FixedWindowRateLimiter(20, 60_000);
const FinishSchema = z.object({ state: z.string().min(1).max(200), token: z.string().min(1).max(2048) });

/**
 * Completes a Twitch sign-in started from the privacy filter page. It needs the HELLO session of the person who
 * started it and the one-time state; the access token is kept in server memory only.
 */
export const POST = viewerRoute('twitch.finish', async ({ userId, request }) => {
  const input = await parseBody(request, FinishSchema, 'That Twitch sign-in is not valid.');
  const { ctx } = await getRuntime();
  limiter.consume(`twitch-finish:${userId}`, ctx.now());
  return jsonOk(await finishTwitch(ctx, userId, input.state, input.token));
});

export const dynamic = 'force-dynamic';
