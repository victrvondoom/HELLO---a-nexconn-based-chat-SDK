import { viewerRoute } from '@/lib/api-handler';
import { jsonOk, parseBody } from '@/lib/http';
import { getRuntime } from '@/lib/runtime';
import { FixedWindowRateLimiter } from '@/lib/rate-limit';
import { actOnStory, StoryActionSchema, storyViewers } from '@/services/moments';

/** Views are sent as a person taps through stories, so the limit is generous; it only stops scripted floods. */
const limiter = new FixedWindowRateLimiter(120, 60_000);
type P = { eventId: string; storyId: string };

/** Who watched and reacted. The author only: anyone else gets "not found". */
export const GET = viewerRoute<P>('moments.story.viewers', async ({ userId, params }) => {
  const { ctx } = await getRuntime();
  return jsonOk({ viewers: await storyViewers(ctx, params.eventId, userId, params.storyId) });
});

/** view, react, unreact or delete. Returns the story as the viewer now sees it, or null once deleted. */
export const POST = viewerRoute<P>('moments.story.act', async ({ userId, params, request }) => {
  const input = await parseBody(request, StoryActionSchema, 'Choose view, react, unreact or delete, and a reaction from the list.');
  const { ctx } = await getRuntime();
  limiter.consume(`story-act:${userId}`, ctx.now());
  return jsonOk({ story: await actOnStory(ctx, params.eventId, userId, params.storyId, input) });
});

export const dynamic = 'force-dynamic';
