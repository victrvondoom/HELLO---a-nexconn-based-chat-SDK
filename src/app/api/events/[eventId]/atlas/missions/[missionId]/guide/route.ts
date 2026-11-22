import { viewerRoute } from '@/lib/api-handler';
import { jsonOk } from '@/lib/http';
import { getRuntime } from '@/lib/runtime';
import { fieldGuide } from '@/services/quest-director';

export const GET = viewerRoute<{ eventId: string; missionId: string }>('atlas.guide', async ({ userId, params }) => {
  const { ctx } = await getRuntime();
  return jsonOk(await fieldGuide(ctx, params.eventId, userId, params.missionId));
});

export const dynamic = 'force-dynamic';
