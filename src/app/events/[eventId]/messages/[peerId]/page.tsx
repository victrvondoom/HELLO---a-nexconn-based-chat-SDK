import Link from 'next/link';
import { notFound } from 'next/navigation';
import { loadEventViewer } from '@/lib/viewer';
import { getProfileView } from '@/services/social';
import { DomainError } from '@/domain/errors';
import { SecureThread } from '@/components/social/SecureThread';
import { Avatar } from '@/components/social/Avatar';
import { FollowButton } from '@/components/social/FollowButton';

export const dynamic = 'force-dynamic';

export default async function ThreadPage({ params }: { params: Promise<{ eventId: string; peerId: string }> }) {
  const { eventId, peerId } = await params;
  const viewer = await loadEventViewer(eventId);
  let peer;
  try {
    peer = await getProfileView(viewer.ctx, eventId, viewer.userId, peerId);
  } catch (error: unknown) {
    if (error instanceof DomainError && (error.code === 'NOT_FOUND' || error.code === 'FORBIDDEN')) notFound();
    throw error;
  }
  if (peer.isSelf) notFound();

  return (
    <div className="page secure-page">
      <div className="secure-head">
        <Link href={`/events/${eventId}/messages`} className="xs">
          ← Private messages
        </Link>
        <Link href={`/events/${eventId}/people/${peer.userId}`} className="row" style={{ gap: 12, color: 'var(--text)' }}>
          <Avatar name={peer.displayName} size={40} ring={peer.relationship.connected} />
          <span>
            <strong>{peer.displayName}</strong>
            <span className="xs faint" style={{ display: 'block' }}>
              {peer.headline ?? (peer.relationship.connected ? 'Connected' : '')}
            </span>
          </span>
        </Link>
      </div>
      {peer.canMessage ? (
        <SecureThread eventId={eventId} me={{ id: viewer.userId, name: viewer.user?.displayName ?? 'You' }} peer={{ id: peer.userId, name: peer.displayName }} />
      ) : (
        <div className="empty card">
          <strong>Follow each other to message privately</strong>
          <span>It keeps unwanted contact out of everyone’s inbox.</span>
          {peer.canFollow ? <FollowButton eventId={eventId} userId={peer.userId} name={peer.displayName} initial={peer.relationship} /> : null}
        </div>
      )}
    </div>
  );
}
