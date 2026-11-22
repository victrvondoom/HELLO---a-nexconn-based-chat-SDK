import { loadEventViewer } from '@/lib/viewer';
import { kingdomView } from '@/services/kingdoms';
import { Kingdom } from '@/components/kingdom/Kingdom';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Kingdom' };

export default async function KingdomPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  const viewer = await loadEventViewer(eventId);
  const initial = await kingdomView(viewer.ctx, eventId, viewer.userId);
  return (
    <div className="page">
      <div className="page-header">
        <div>
          <p className="eyebrow">Shared world</p>
          <h1>Kingdom</h1>
          <p>A persistent world this event lives in. The host rules it, everyone who joins gets a home, and what happens in the event happens here.</p>
        </div>
      </div>
      <Kingdom eventId={eventId} initial={initial} />
    </div>
  );
}
