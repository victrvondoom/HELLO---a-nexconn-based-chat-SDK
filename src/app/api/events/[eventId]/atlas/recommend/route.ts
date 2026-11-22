import { viewerRoute } from '@/lib/api-handler';
import { jsonOk, parseBody } from '@/lib/http';
import { getRuntime } from '@/lib/runtime';
import { recommendFor, RecommendSchema } from '@/services/quest-director';

export const POST = viewerRoute<{ eventId: string }>('atlas.recommend', async ({ userId, params, request }) => {
  const input = await parseBody(request, RecommendSchema, 'Check the time and place you entered.');
  const { ctx } = await getRuntime();
  return jsonOk(await recommendFor(ctx, params.eventId, userId, input));
});

export const dynamic = 'force-dynamic';
