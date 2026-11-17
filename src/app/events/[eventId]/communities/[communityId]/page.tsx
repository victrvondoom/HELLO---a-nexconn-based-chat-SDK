import Link from 'next/link';
import { notFound } from 'next/navigation';
import { loadEventViewer } from '@/lib/viewer';
import { DomainError } from '@/domain/errors';
import { getCommunity } from '@/services/communities';
import { listFeed } from '@/services/feed';
import { countryName } from '@/lib/geo';
import { FeedView } from '@/components/feed/FeedView';
import { CommunityActions, StartCallButton } from '@/components/community/Communities';

export const dynamic = 'force-dynamic';

export default async function CommunityPage({ params }: { params: Promise<{ eventId: string; communityId: string }> }) {
  const { eventId, communityId } = await params;
  const viewer = await loadEventViewer(eventId);
  const community = await getCommunity(viewer.ctx, eventId, viewer.userId, communityId).catch((error: unknown) => {
    if (error instanceof DomainError && error.code === 'NOT_FOUND') notFound();
    throw error;
  });
  const posts = await listFeed(viewer.ctx, eventId, viewer.userId, { scope: 'all', communityId: community.id, authorId: null });
  return (
    <div className="page">
      <p className="eyebrow">
        <Link href={`/events/${eventId}/communities`}>Communities</Link> / {community.name}
      </p>
      <div className="page-header">
        <div>
          <h1>{community.name}</h1>
          <p>
            {community.description || 'No description yet.'} · {community.members} {community.members === 1 ? 'member' : 'members'} · {countryName(community.country) ?? 'Worldwide'} · run by {community.owner.name}
          </p>
        </div>
        <div className="row" style={{ gap: 8 }}>
          {community.joined ? <StartCallButton eventId={eventId} communityId={community.id} title={`${community.name} call`} /> : null}
          <CommunityActions eventId={eventId} community={community} />
        </div>
      </div>
      <FeedView
        eventId={eventId}
        initial={{ now: viewer.ctx.now(), posts }}
        communityId={community.id}
        canPost={community.joined && viewer.can('message.send')}
        postHint="Join this community to post in it."
      />
    </div>
  );
}
