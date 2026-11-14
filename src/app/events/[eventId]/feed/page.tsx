import { loadEventViewer } from '@/lib/viewer';
import { listFeed } from '@/services/feed';
import { FeedView } from '@/components/feed/FeedView';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Feed' };

export default async function FeedPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  const viewer = await loadEventViewer(eventId);
  const posts = await listFeed(viewer.ctx, eventId, viewer.userId, { scope: 'all', communityId: null, authorId: null });
  return (
    <div className="page">
      <div className="page-header">
        <div>
          <p className="eyebrow">Everyone connected</p>
          <h1>Feed</h1>
          <p>Posts, pictures and videos from people at this event. Follow someone on their profile to see them under Following.</p>
        </div>
      </div>
      <FeedView eventId={eventId} initial={{ now: viewer.ctx.now(), posts }} canPost={viewer.can('message.send')} />
    </div>
  );
}
