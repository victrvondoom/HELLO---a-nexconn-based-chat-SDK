import Link from 'next/link';
import { loadEventViewer } from '@/lib/viewer';
import { kingdomView } from '@/services/kingdoms';
import { Kingdom3D } from '@/components/kingdom/Kingdom3D';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Kingdom 3D' };

export default async function KingdomWorldPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  const viewer = await loadEventViewer(eventId);
  const { kingdom } = await kingdomView(viewer.ctx, eventId, viewer.userId);
  const name = kingdom?.name ?? 'Your kingdom';
  return (
    <div className="page">
      <div className="page-header">
        <div>
          <p className="eyebrow">Shared world</p>
          <h1>{name} in 3D</h1>
          <p>
            The voxel kingdom renderer, with simulated townsfolk. <Link href={`/events/${eventId}/kingdom`}>Back to the kingdom</Link>
          </p>
        </div>
      </div>
      <Kingdom3D seed={kingdom ? String(kingdom.seed) : eventId} name={name} />
    </div>
  );
}
