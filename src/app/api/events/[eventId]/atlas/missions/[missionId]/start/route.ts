import { viewerRoute } from '@/lib/api-handler';
import { jsonOk } from '@/lib/http';
import { getRuntime } from '@/lib/runtime';
import { startMission } from '@/services/field-atlas';

export const POST = viewerRoute<{ eventId: string; missionId: string }>('atlas.start', async ({ userId, params }) => {
  const { ctx } = await getRuntime();
  return jsonOk(await startMission(ctx, params.eventId, userId, params.missionId));
});
