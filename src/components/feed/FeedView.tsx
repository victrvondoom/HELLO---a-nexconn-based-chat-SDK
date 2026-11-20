'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useLive } from '@/components/live/client';
import { PostCard } from '@/components/moments/PostCard';
import { PostComposer } from '@/components/moments/PostComposer';
import type { PostView } from '@/services/feed';

type Scope = 'all' | 'following' | 'latest';
interface FeedData {
  now: number;
  posts: PostView[];
}

interface Props {
  eventId: string;
  initial: FeedData;
  /** Limits the feed to one community, and posts into it. */
  communityId?: string;
  /** Limits the feed to one person's posts. */
  authorId?: string;
  canPost: boolean;
  /** Why posting is unavailable, shown in place of the composer. */
  postHint?: string;
  /** Open the composer straight away (the "New post" shortcut). */
  composeOnLoad?: boolean;
}

const SCOPE_LABEL: Record<Scope, string> = { all: 'For you', following: 'Following', latest: 'Latest' };
const DAY = 24 * 60 * 60 * 1000;

/**
 * The Moments feed. "For you" is ordered by the Open Feed Charter (six announced rules, shown on every
 * post); "Following" and "Latest" are newest first. It ends with a clear "all caught up", not an endless
 * scroll.
 */
export function FeedView({ eventId, initial, communityId, authorId, canPost, postHint, composeOnLoad = false }: Props) {
  const base = `/api/events/${eventId}`;
  // A person's own posts read newest first; the event feed starts with the charter's "For you".
  const [scope, setScope] = useState<Scope>(authorId ? 'latest' : 'all');
  const query = new URLSearchParams({ scope });
  if (communityId) query.set('community', communityId);
  if (authorId) query.set('author', authorId);
  const { data, refresh, stale } = useLive<FeedData>(`${base}/feed?${query.toString()}`, initial, 8000);
  const recent = data.posts.filter((p) => data.now - p.createdAt <= DAY);
  const earlier = data.posts.filter((p) => data.now - p.createdAt > DAY);

  return (
    <div className="feed">
      {canPost ? <PostComposer eventId={eventId} communityId={communityId} onPosted={refresh} autoOpen={composeOnLoad} /> : postHint ? <p className="notice">{postHint}</p> : null}
      {!authorId ? (
        <div className="feed__bar">
          <nav className="segmented" aria-label="Feed views">
            {(Object.keys(SCOPE_LABEL) as Scope[]).map((s) => (
              <button key={s} type="button" className={scope === s ? 'segmented__item is-active' : 'segmented__item'} aria-pressed={scope === s} onClick={() => { setScope(s); }}>
                {SCOPE_LABEL[s]}
              </button>
            ))}
          </nav>
          {stale ? (
            <span className="stale-note" role="status">
              Reconnecting…
            </span>
          ) : scope === 'all' ? (
            <Link className="xs feed__charter-link" href={`/events/${eventId}/feed/charter`}>
              Ordered by 6 announced rules
            </Link>
          ) : null}
        </div>
      ) : null}
      {data.posts.length === 0 ? (
        <div className="empty">
          <strong>Nothing here yet</strong>
          <p>{scope === 'following' ? 'Posts from people you follow appear here.' : 'Be the first to post.'}</p>
        </div>
      ) : (
        <>
          {recent.map((post) => (
            <PostCard key={post.id} eventId={eventId} post={post} now={data.now} onChanged={refresh} />
          ))}
          {recent.length > 0 ? (
            <div className="caught-up" role="note">
              <span className="caught-up__mark" aria-hidden="true" />
              <strong>You are all caught up</strong>
              <span className="small muted">You have seen every post from the last day{earlier.length > 0 ? '. Older posts are below.' : '.'}</span>
              <Link className="small" href={`/events/${eventId}/feed/explore`}>
                Explore what people are talking about
              </Link>
            </div>
          ) : null}
          {earlier.map((post) => (
            <PostCard key={post.id} eventId={eventId} post={post} now={data.now} onChanged={refresh} />
          ))}
        </>
      )}
    </div>
  );
}
