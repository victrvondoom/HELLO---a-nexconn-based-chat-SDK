import { loadEventViewer } from '@/lib/viewer';
import { listFeed } from '@/services/feed';
import { MomentsNav } from '@/components/moments/MomentsNav';
import { ReelsView } from '@/components/moments/ReelsView';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Reels' };

export default async function ReelsPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  const viewer = await loadEventViewer(eventId);
  const posts = await listFeed(viewer.ctx, eventId, viewer.userId, { scope: 'visual', communityId: null, authorId: null });
  return (
    <div className="page page--moments">
      <div className="page-header page-header--moments">
        <div>
          <p className="eyebrow">Moments</p>
          <h1>Reels</h1>
        </div>
        <MomentsNav eventId={eventId} />
      </div>
      <ReelsView eventId={eventId} initial={{ now: viewer.ctx.now(), posts }} />
    </div>
  );
}
