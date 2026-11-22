import { viewerRoute } from '@/lib/api-handler';
import { jsonOk, parseBody } from '@/lib/http';
import { getRuntime } from '@/lib/runtime';
import { CustomMapCreate, createCustomMap, listCustomMaps } from '@/services/custom-maps';

/** The viewer's own custom maps and the ones others shared with the event. */
export const GET = viewerRoute<{ eventId: string }>('maps.list', async ({ userId, params }) => {
  const { ctx } = await getRuntime();
  return jsonOk(await listCustomMaps(ctx, params.eventId, userId));
});

export const POST = viewerRoute<{ eventId: string }>('maps.create', async ({ userId, params, request }) => {
  const body = await parseBody(request, CustomMapCreate, 'Give the map a name and upload its picture.');
  const { ctx } = await getRuntime();
  return jsonOk(await createCustomMap(ctx, params.eventId, userId, body), 201);
});

export const dynamic = 'force-dynamic';
