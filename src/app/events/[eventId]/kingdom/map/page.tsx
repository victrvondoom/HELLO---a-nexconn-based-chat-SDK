import Link from 'next/link';
import { loadEventViewer } from '@/lib/viewer';
import { kingdomView } from '@/services/kingdoms';
import { KingdomMap } from '@/components/kingdom/KingdomMap';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Kingdom map' };

export default async function KingdomMapPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  const viewer = await loadEventViewer(eventId);
  const own = (await kingdomView(viewer.ctx, eventId, viewer.userId)).kingdom;
  return (
    <div className="page">
      <div className="page-header">
        <div>
          <p className="eyebrow">Atlas</p>
          <h1>Every channel is a door</h1>
          <p>
            Each language is a continent; smaller ones share the Isles of Many Tongues. Click a door to see its living kingdom. Lit doors are live.
            {own ? null : (
              <>
                {' '}
                Your event has no kingdom yet: <Link href={`/events/${eventId}/kingdom`}>found it</Link>.
              </>
            )}
          </p>
        </div>
      </div>
      <KingdomMap own={own ? { name: own.name, seed: String(own.seed) } : null} />
    </div>
  );
}
