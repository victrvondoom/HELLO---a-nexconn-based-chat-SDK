import { loadEventViewer } from '@/lib/viewer';
import { liveFeed } from '@/services/live';
import { LiveRefresh } from '@/components/workplace/LiveRefresh';
import { LiveScene } from '@/components/live/LiveScene';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Live' };

export default async function LivePage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  const viewer = await loadEventViewer(eventId);
  const feed = await liveFeed(viewer.ctx, eventId, viewer.userId);

  const venue = await viewer.store.getVenue(eventId);
  const rooms = await viewer.store.listRooms(eventId);
  const spaces = (venue?.spaces ?? []).map((space) => ({ id: space.id, name: space.name, floor: space.floor }));
  // Zones are the unit a hold covers. A room's zone is its zone; a space without a room is its own zone.
  const zones = [...new Set([...rooms.map((room) => room.zone), ...(venue?.spaces ?? []).filter((space) => !space.roomId).map((space) => space.name)])].sort();

  return (
    <div className="page page--wide">
      <LiveRefresh />
      <div className="page-header">
        <div>
          <p className="eyebrow">Happening now</p>
          <h1>Live</h1>
          <p>
            Reports about places at the event. A report stays live for a limited time, then leaves this view. Staff review
            safety reports, and can suspend the live view for one zone while they check. Private messages are never affected.
          </p>
        </div>
      </div>
      <LiveScene eventId={eventId} initial={feed} spaces={spaces} zones={zones} />
    </div>
  );
}
