import { loadEventViewer } from '@/lib/viewer';
import { listMissionsForViewer, playerState, seasonsForViewer } from '@/services/field-atlas';
import { FieldAtlas, type AtlasHome } from '@/components/atlas/FieldAtlas';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Field Atlas' };

export default async function FieldAtlasPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  const viewer = await loadEventViewer(eventId);
  const { ctx, userId } = viewer;
  const [player, missions, seasons, venue] = await Promise.all([
    playerState(ctx, eventId, userId),
    listMissionsForViewer(ctx, eventId, userId),
    seasonsForViewer(ctx, eventId, userId),
    ctx.store.getVenue(eventId),
  ]);
  const initial: AtlasHome = {
    player,
    missions,
    season: seasons.current,
    venue: venue ? { name: venue.name, width: venue.width, depth: venue.depth, floors: venue.floors.map((f) => ({ id: f.id, name: f.name })), spaces: venue.spaces.map((s) => ({ id: s.id, floor: s.floor, name: s.name, kind: s.kind, outline: s.outline, stepFree: s.stepFree, roomId: s.roomId })) } : null,
    serverTime: ctx.now(),
  };
  return (
    <div className="page">
      <div className="page-header">
        <div>
          <p className="eyebrow">Field Atlas</p>
          <h1>Missions and progress</h1>
          <p>Find a mission on the map, complete it, and have it verified. XP and badges are awarded by the server only after verification.</p>
        </div>
      </div>
      <FieldAtlas eventId={eventId} initial={initial} cabinetHref={`/events/${eventId}/atlas`} />
    </div>
  );
}
