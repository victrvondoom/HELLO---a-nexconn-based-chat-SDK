import { viewerRoute } from '@/lib/api-handler';
import { jsonOk } from '@/lib/http';
import { getRuntime } from '@/lib/runtime';
import { atlasHome } from '@/services/field-live';

/**
 * The Field Atlas home: progression, the current season, every mission this person can see, and the live
 * layer (field conditions per place and the anonymous season pulse). Polled by the atlas every 15 seconds.
 */
export const GET = viewerRoute<{ eventId: string }>('atlas.home', async ({ userId, params }) => {
  const { ctx } = await getRuntime();
  return jsonOk(await atlasHome(ctx, params.eventId, userId));
});
