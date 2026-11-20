import { viewerRoute } from '@/lib/api-handler';
import { jsonOk, parseBody } from '@/lib/http';
import { getRuntime } from '@/lib/runtime';
import { FixedWindowRateLimiter } from '@/lib/rate-limit';
import { listSaved, SaveSchema, setSaved } from '@/services/moments';

const limiter = new FixedWindowRateLimiter(90, 60_000);

/** The viewer's own saved posts, most recently saved first. Nobody else can list them. */
export const GET = viewerRoute<{ eventId: string }>('moments.saves', async ({ userId, params }) => {
  const { ctx } = await getRuntime();
  return jsonOk({ now: ctx.now(), posts: await listSaved(ctx, params.eventId, userId) });
});

export const POST = viewerRoute<{ eventId: string }>('moments.saves.set', async ({ userId, params, request }) => {
  const input = await parseBody(request, SaveSchema, 'Choose a post, and whether to save it.');
  const { ctx } = await getRuntime();
  limiter.consume(`save:${userId}`, ctx.now());
  return jsonOk(await setSaved(ctx, params.eventId, userId, input.postId, input.on));
});
