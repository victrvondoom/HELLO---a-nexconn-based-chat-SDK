import { loadEventViewer } from '@/lib/viewer';
import { listMyPlaces } from '@/services/places';
import { LiveRefresh } from '@/components/workplace/LiveRefresh';
import { PlacesBoard } from '@/components/places/PlacesBoard';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'My places' };

export default async function PlacesPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  const viewer = await loadEventViewer(eventId);
  const listing = await listMyPlaces(viewer.ctx, eventId, viewer.userId);

  return (
    <div className="page page--wide">
      <LiveRefresh />
      <div className="page-header">
        <div>
          <p className="eyebrow">Only you can see this</p>
          <h1>My places</h1>
          <p>
            The places you want to remember at this event: where to eat, what to see, where you want to go. Your private
            notes are visible only to you. Nothing here is shared with other people.
          </p>
        </div>
      </div>
      <PlacesBoard eventId={eventId} initial={listing} />
    </div>
  );
}
