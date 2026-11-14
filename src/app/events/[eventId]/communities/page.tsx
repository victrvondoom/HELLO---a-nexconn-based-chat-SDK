import { loadEventViewer } from '@/lib/viewer';
import { listCommunities } from '@/services/communities';
import { COUNTRIES } from '@/lib/geo';
import { Communities } from '@/components/community/Communities';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Communities' };

export default async function CommunitiesPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  const viewer = await loadEventViewer(eventId);
  const communities = await listCommunities(viewer.ctx, eventId, viewer.userId);
  return (
    <div className="page">
      <div className="page-header">
        <div>
          <p className="eyebrow">Groups</p>
          <h1>Communities</h1>
          <p>Open groups inside the event. Anyone can join; members can post and start a group call.</p>
        </div>
      </div>
      <Communities eventId={eventId} initial={communities} countries={[...COUNTRIES]} canCreate={viewer.can('message.send')} />
    </div>
  );
}
