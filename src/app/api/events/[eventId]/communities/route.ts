import { viewerRoute } from '@/lib/api-handler';
import { jsonOk, parseBody } from '@/lib/http';
import { getRuntime } from '@/lib/runtime';
import { FixedWindowRateLimiter } from '@/lib/rate-limit';
import { CommunitySchema, createCommunity, listCommunities } from '@/services/communities';

const limiter = new FixedWindowRateLimiter(6, 60_000);

export const GET = viewerRoute<{ eventId: string }>('communities.list', async ({ userId, params }) => {
  const { ctx } = await getRuntime();
  return jsonOk({ communities: await listCommunities(ctx, params.eventId, userId) });
});

export const POST = viewerRoute<{ eventId: string }>('communities.create', async ({ userId, params, request }) => {
  const input = await parseBody(request, CommunitySchema, 'Name: 3 to 60 characters. Description: up to 300.');
  const { ctx } = await getRuntime();
  limiter.consume(`community:${userId}`, ctx.now());
  const community = await createCommunity(ctx, params.eventId, userId, input);
  return jsonOk({ id: community.id }, 201);
});

export const dynamic = 'force-dynamic';
