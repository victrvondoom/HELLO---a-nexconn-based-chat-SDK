import { viewerRoute } from '@/lib/api-handler';
import { jsonOk, parseBody } from '@/lib/http';
import { getRuntime } from '@/lib/runtime';
import { handOff, HandoffSchema } from '@/services/ops/handoff';

export const POST = viewerRoute<{ eventId: string; incidentId: string }>('ops.handoff', async ({ userId, params, request }) => {
  const input = await parseBody(request, HandoffSchema, 'Choose a handoff action.');
  const { ctx } = await getRuntime();
  return jsonOk(await handOff(ctx, params.eventId, userId, params.incidentId, input));
});

export const dynamic = 'force-dynamic';
