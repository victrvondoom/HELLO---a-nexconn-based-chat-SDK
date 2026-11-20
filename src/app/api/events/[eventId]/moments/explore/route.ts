import { viewerRoute } from '@/lib/api-handler';
import { jsonOk } from '@/lib/http';
import { getRuntime } from '@/lib/runtime';
import { explore } from '@/services/moments';

/** The explore grid and trending tags; `?tag=robotics` (with or without `#`) lists the posts with that tag. */
export const GET = viewerRoute<{ eventId: string }>('moments.explore', async ({ userId, params, request }) => {
  const tag = new URL(request.url).searchParams.get('tag');
  const { ctx } = await getRuntime();
  return jsonOk(await explore(ctx, params.eventId, userId, { tag: tag === null || tag.trim() === '' ? null : tag }));
});
