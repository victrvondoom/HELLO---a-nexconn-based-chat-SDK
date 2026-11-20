import { viewerRoute } from '@/lib/api-handler';
import { jsonOk, parseBody } from '@/lib/http';
import { getRuntime } from '@/lib/runtime';
import { FixedWindowRateLimiter } from '@/lib/rate-limit';
import { ruleMessage } from '@/domain/moments/rules';
import { createStory, storyTray, StorySchema } from '@/services/moments';

/**
 * Rule R4 is also counted over stored stories in the service; this limiter keeps a burst of requests from
 * reaching the store at all, and gives the same answer.
 */
const limiter = new FixedWindowRateLimiter(10, 3_600_000, ruleMessage('R4-pace'));

/** The story tray: your ring first, then everyone whose live stories you may see, in the announced order. */
export const GET = viewerRoute<{ eventId: string }>('moments.stories', async ({ userId, params }) => {
  const { ctx } = await getRuntime();
  return jsonOk(await storyTray(ctx, params.eventId, userId));
});

export const POST = viewerRoute<{ eventId: string }>('moments.stories.create', async ({ userId, params, request }) => {
  const input = await parseBody(request, StorySchema, `${ruleMessage('R1-length')} Choose the story type, backdrop and audience from the lists.`);
  const { ctx } = await getRuntime();
  limiter.consume(`story:${userId}`, ctx.now());
  const story = await createStory(ctx, params.eventId, userId, input);
  return jsonOk({ id: story.id, expiresAt: story.expiresAt }, 201);
});
