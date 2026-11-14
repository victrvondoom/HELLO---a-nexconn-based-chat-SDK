import { viewerRoute } from '@/lib/api-handler';
import { jsonOk, parseBody } from '@/lib/http';
import { getRuntime } from '@/lib/runtime';
import { FixedWindowRateLimiter } from '@/lib/rate-limit';
import { actOnPost, listComments, PostActionSchema } from '@/services/feed';

const limiter = new FixedWindowRateLimiter(90, 60_000);
type P = { eventId: string; postId: string };

export const GET = viewerRoute<P>('feed.comments', async ({ userId, params }) => {
  const { ctx } = await getRuntime();
  return jsonOk({ comments: await listComments(ctx, params.eventId, userId, params.postId) });
});

export const POST = viewerRoute<P>('feed.act', async ({ userId, params, request }) => {
  const input = await parseBody(request, PostActionSchema, 'Comments can be up to 500 characters.');
  const { ctx } = await getRuntime();
  limiter.consume(`post-act:${userId}`, ctx.now());
  await actOnPost(ctx, params.eventId, userId, params.postId, input);
  return jsonOk({ done: true });
});
