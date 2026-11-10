import { viewerRoute } from '@/lib/api-handler';
import { jsonOk } from '@/lib/http';
import { getRuntime } from '@/lib/runtime';
import { sweepOverdueIncidents } from '@/services/workplace';

export const POST = viewerRoute<{ eventId: string }>('sla.sweep', async ({ userId, params }) => {
  const { ctx } = await getRuntime();
  return jsonOk(await sweepOverdueIncidents(ctx, params.eventId, userId));
});
