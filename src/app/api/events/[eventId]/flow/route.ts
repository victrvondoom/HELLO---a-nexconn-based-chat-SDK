import { viewerRoute } from '@/lib/api-handler';
import { jsonOk } from '@/lib/http';
import { getRuntime } from '@/lib/runtime';
import { flowSnapshot } from '@/services/workflows';

export const GET = viewerRoute<{ eventId: string }>('flow.snapshot', async ({ userId, params }) => {
  const { ctx } = await getRuntime();
  return jsonOk(await flowSnapshot(ctx, params.eventId, userId));
});
