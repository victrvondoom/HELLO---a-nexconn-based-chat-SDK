import { viewerRoute } from '@/lib/api-handler';
import { jsonOk, parseBody } from '@/lib/http';
import { getRuntime } from '@/lib/runtime';
import { FixedWindowRateLimiter } from '@/lib/rate-limit';
import { actOnCommunity, CommunityActionSchema } from '@/services/communities';

const limiter = new FixedWindowRateLimiter(40, 60_000);

export const POST = viewerRoute<{ eventId: string; communityId: string }>('communities.act', async ({ userId, params, request }) => {
  const input = await parseBody(request, CommunityActionSchema, 'Choose join, leave or delete.');
  const { ctx } = await getRuntime();
  limiter.consume(`community-act:${userId}`, ctx.now());
  await actOnCommunity(ctx, params.eventId, userId, params.communityId, input.action);
  return jsonOk({ done: true });
});

export const dynamic = 'force-dynamic';
