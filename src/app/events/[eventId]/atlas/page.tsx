import { loadEventViewer } from '@/lib/viewer';
import { atlasHome } from '@/services/field-live';
import { FieldAtlas, type AtlasHome } from '@/components/atlas/FieldAtlas';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Field Atlas' };

export default async function FieldAtlasPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  const viewer = await loadEventViewer(eventId);
  const { ctx, userId } = viewer;
  // The same object the API route serves on every poll, so the first render and live updates never disagree.
  const initial: AtlasHome = await atlasHome(ctx, eventId, userId);
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
