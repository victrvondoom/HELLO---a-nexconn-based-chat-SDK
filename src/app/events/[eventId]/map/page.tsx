import { loadEventViewer } from '@/lib/viewer';
import { VenueMap, type MapRoomInfo } from '@/components/map/VenueMap';
import { DATA_SOURCE_LABEL } from '@/domain/labels';
import { placesOf } from '@/domain/venue/types';
import { formatUtc } from '@/components/ui/labels';

export const dynamic = 'force-dynamic';

const OPEN = new Set(['CLOSED', 'CANCELLED', 'CONFIRMED']);

export default async function MapPage({
  params,
  searchParams,
}: {
  params: Promise<{ eventId: string }>;
  searchParams: Promise<{ to?: string; from?: string }>;
}) {
  const { eventId } = await params;
  const { to, from } = await searchParams;
  const viewer = await loadEventViewer(eventId);
  const operational = viewer.can('incident.read.operational');
  const venue = await viewer.store.getVenue(eventId);

  if (!venue) {
    return (
      <div className="page">
        <h1>Venue map</h1>
        <div className="empty card" style={{ marginTop: 16 }}>
          <strong>No map for this event yet</strong>
          <span>An organiser has not drawn the venue. Directions are available from staff at registration.</span>
        </div>
      </div>
    );
  }

  const now = viewer.ctx.now();
  const [rooms, sessions, incidents] = await Promise.all([
    viewer.store.listRooms(eventId),
    viewer.store.listSessions(eventId),
    operational ? viewer.store.listIncidents(eventId) : Promise.resolve([]),
  ]);
  const info: Record<string, MapRoomInfo> = {};
  for (const r of rooms) {
    const upcoming = sessions
      .filter((s) => s.roomId === r.id && s.endsAt > now)
      .sort((a, b) => a.startsAt - b.startsAt)[0];
    info[r.id] = {
      roomId: r.id,
      capacity: r.capacity,
      occupancy: r.occupancy,
      sourceLabel: r.occupancySource ? DATA_SOURCE_LABEL[r.occupancySource] : null,
      openIncidents: operational ? incidents.filter((i) => i.roomId === r.id && !OPEN.has(i.status)).length : null,
      nowOrNext: upcoming
        ? `${upcoming.startsAt <= now ? 'Now' : `Next at ${formatUtc(upcoming.startsAt).slice(11)}`}: ${upcoming.title}`
        : null,
    };
  }

  // Deep links: ?to=r-3 (a schedule room) or ?to=sp-r3 / poi-first-aid (a place).
  const places = placesOf(venue);
  const resolve = (id: string | undefined) =>
    id ? (places.find((p) => p.id === id)?.id ?? venue.spaces.find((s) => s.roomId === id)?.id ?? null) : null;
  const target = resolve(to);
  const origin = resolve(from) ?? (viewer.user?.accessibilityRequired ? 'poi-east-entrance' : 'poi-main-entrance');

  return (
    <div className="page page--wide">
      <div className="page-header">
        <div>
          <p className="eyebrow">Wayfinding</p>
          <h1>Venue map</h1>
          <p>
            Three views of one model. Directions are worked out on your device{viewer.user?.accessibilityRequired ? ', step-free by default because your profile asks for it' : ''}. No map service outside
            HELLO is contacted.
          </p>
        </div>
      </div>
      <VenueMap
        venue={venue}
        rooms={info}
        initialFrom={origin}
        initialTo={target}
        initialStepFree={viewer.user?.accessibilityRequired ?? false}
        operational={operational}
      />
    </div>
  );
}
