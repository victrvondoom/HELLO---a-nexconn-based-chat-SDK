import { viewerRoute } from '@/lib/api-handler';
import { jsonOk } from '@/lib/http';
import { getRuntime } from '@/lib/runtime';
import { listMissionsForViewer, playerState, seasonsForViewer } from '@/services/field-atlas';

/** The Field Atlas home: progression, the current season and every mission this person can see. */
export const GET = viewerRoute<{ eventId: string }>('atlas.home', async ({ userId, params }) => {
  const { ctx } = await getRuntime();
  const [player, missions, seasons, venue] = await Promise.all([
    playerState(ctx, params.eventId, userId),
    listMissionsForViewer(ctx, params.eventId, userId),
    seasonsForViewer(ctx, params.eventId, userId),
    ctx.store.getVenue(params.eventId),
  ]);
  return jsonOk({
    player,
    missions,
    season: seasons.current,
    venue: venue ? { name: venue.name, width: venue.width, depth: venue.depth, floors: venue.floors.map((f) => ({ id: f.id, name: f.name })), spaces: venue.spaces.map((s) => ({ id: s.id, floor: s.floor, name: s.name, kind: s.kind, outline: s.outline, stepFree: s.stepFree, roomId: s.roomId })) } : null,
    serverTime: ctx.now(),
  });
});
