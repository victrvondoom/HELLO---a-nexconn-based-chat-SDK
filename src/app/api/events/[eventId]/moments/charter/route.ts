import { viewerRoute } from '@/lib/api-handler';
import { jsonOk } from '@/lib/http';
import { getRuntime } from '@/lib/runtime';
import { momentsCharter } from '@/services/moments';

/** The Open Feed Charter, the story order, the posting rules and the Nexconn message types, for anyone in the event. */
export const GET = viewerRoute<{ eventId: string }>('moments.charter', async ({ userId, params }) => {
  const { ctx } = await getRuntime();
  return jsonOk(await momentsCharter(ctx, params.eventId, userId));
});
