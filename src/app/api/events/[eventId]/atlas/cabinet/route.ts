import { viewerRoute } from '@/lib/api-handler';
import { jsonOk } from '@/lib/http';
import { getRuntime } from '@/lib/runtime';
import { cabinetFor } from '@/services/field-atlas';

export const GET = viewerRoute<{ eventId: string }>('atlas.cabinet', async ({ userId, params }) => {
  const { ctx } = await getRuntime();
  return jsonOk(await cabinetFor(ctx, params.eventId, userId));
});
