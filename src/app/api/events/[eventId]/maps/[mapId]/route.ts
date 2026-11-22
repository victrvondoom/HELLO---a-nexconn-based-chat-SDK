import { viewerRoute } from '@/lib/api-handler';
import { jsonOk, parseBody } from '@/lib/http';
import { getRuntime } from '@/lib/runtime';
import { CustomMapPatch, deleteCustomMap, updateCustomMap } from '@/services/custom-maps';

/** Rename a map, move its pins, or share it. Only its owner can. */
export const PUT = viewerRoute<{ eventId: string; mapId: string }>('maps.update', async ({ userId, params, request }) => {
  const body = await parseBody(request, CustomMapPatch, 'Check the map: names up to 80 characters, up to 60 pins.');
  const { ctx } = await getRuntime();
  return jsonOk(await updateCustomMap(ctx, params.eventId, userId, params.mapId, body));
});

export const DELETE = viewerRoute<{ eventId: string; mapId: string }>('maps.delete', async ({ userId, params }) => {
  const { ctx } = await getRuntime();
  await deleteCustomMap(ctx, params.eventId, userId, params.mapId);
  return jsonOk({ deleted: true });
});

export const dynamic = 'force-dynamic';
