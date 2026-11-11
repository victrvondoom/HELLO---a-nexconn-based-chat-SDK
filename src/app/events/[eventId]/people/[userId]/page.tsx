import Link from 'next/link';
import { notFound } from 'next/navigation';
import { loadEventViewer } from '@/lib/viewer';
import { getProfileView } from '@/services/social';
import { DomainError } from '@/domain/errors';
import { ROLE_LABEL } from '@/components/ui/labels';
import { FollowButton } from '@/components/social/FollowButton';
import { Avatar } from '@/components/social/Avatar';
import { Icon } from '@/components/ui/Icon';

export const dynamic = 'force-dynamic';

const VISIBILITY_LABEL = {
  EVENT: 'Visible to everyone at the event',
  CONNECTIONS: 'Visible to mutual connections only',
  ONLY_ME: 'Visible only to you',
} as const;

export default async function ProfilePage({ params }: { params: Promise<{ eventId: string; userId: string }> }) {
  const { eventId, userId } = await params;
  const viewer = await loadEventViewer(eventId);
  let profile;
  try {
    profile = await getProfileView(viewer.ctx, eventId, viewer.userId, userId);
  } catch (error: unknown) {
    if (error instanceof DomainError && (error.code === 'NOT_FOUND' || error.code === 'FORBIDDEN')) notFound();
    throw error;
  }

  return (
    <div className="page" style={{ maxWidth: 920 }}>
      <p className="eyebrow">
        <Link href={`/events/${eventId}/people`}>People</Link> / Profile
      </p>
      <article className="profile">
        <div className="profile__cover" aria-hidden="true">
          <span className="profile__orb profile__orb--1" />
          <span className="profile__orb profile__orb--2" />
        </div>
        <div className="profile__head">
          <Avatar name={profile.displayName} size={96} ring={profile.relationship.connected} />
          <div className="profile__actions">
            {profile.isSelf ? (
              <Link className="button button--ghost" href={`/events/${eventId}/settings`}>
                Edit profile
              </Link>
            ) : (
              <>
                {profile.canMessage ? (
                  <Link className="button button--ghost" href={`/events/${eventId}/messages/${profile.userId}`}>
                    <Icon name="lock" size={15} /> Message
                  </Link>
                ) : null}
                {profile.canFollow ? (
                  <FollowButton eventId={eventId} userId={profile.userId} name={profile.displayName} initial={profile.relationship} />
                ) : null}
              </>
            )}
          </div>
        </div>
        <div className="profile__body">
          <h1>{profile.displayName}</h1>
          <div className="row" style={{ gap: 8, marginTop: 6 }}>
            <span className="badge badge--accent">{ROLE_LABEL[profile.role]}</span>
            {profile.relationship.connected ? <span className="badge badge--success">Connected</span> : profile.relationship.followsYou ? <span className="badge">Follows you</span> : null}
          </div>
          {profile.headline ? <p className="profile__headline">{profile.headline}</p> : null}
          <div className="profile__counts">
            <span>
              <strong>{profile.followers}</strong> followers
            </span>
            <span>
              <strong>{profile.following}</strong> following
            </span>
          </div>
          {profile.hiddenReason ? (
            <p className="notice notice--info small" style={{ marginTop: 16 }}>
              <Icon name="lock" size={14} /> {profile.hiddenReason}
            </p>
          ) : profile.bio ? (
            <p className="profile__bio">{profile.bio}</p>
          ) : null}
          {profile.interests.length > 0 ? (
            <div className="tags" style={{ marginTop: 16 }}>
              {profile.interests.map((i) => (
                <span key={i} className="tag">
                  {i}
                </span>
              ))}
            </div>
          ) : null}
          {!profile.isSelf && !profile.canMessage ? (
            <p className="xs faint" style={{ marginTop: 20 }}>
              Private messages open once you follow each other. It keeps unwanted contact out of everyone’s inbox.
            </p>
          ) : null}
          {profile.isSelf ? (
            <p className="xs faint" style={{ marginTop: 20 }}>
              {VISIBILITY_LABEL[profile.visibility]}. Your headline and bio are encrypted at rest. Who follows you is visible only to you.
            </p>
          ) : null}
        </div>
      </article>
    </div>
  );
}
