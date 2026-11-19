import { loadEventViewer } from '@/lib/viewer';
import { mapView } from '@/services/location';
import { COUNTRY_SHAPES } from '@/lib/geo';
import { LiveMap } from '@/components/map/LiveMap';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Live map' };

export default async function LiveMapPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  const viewer = await loadEventViewer(eventId);
  const map = await mapView(viewer.ctx, eventId, viewer.userId);
  const view = { now: map.now, me: map.me, people: map.people, countries: map.countries, myCountry: map.myCountry, hiddenCountries: map.hiddenCountries, minGroupSize: map.minGroupSize };
  return (
    <div className="page page--wide">
      <div className="page-header">
        <div>
          <p className="eyebrow">By choice only</p>
          <h1>Live map</h1>
          <p>See where people at the event are from, and find the people who chose to share where they are right now. The map is drawn in the app: no map service is told where anyone is.</p>
        </div>
      </div>
      <LiveMap eventId={eventId} shapes={[...COUNTRY_SHAPES]} initial={view} />
    </div>
  );
}
