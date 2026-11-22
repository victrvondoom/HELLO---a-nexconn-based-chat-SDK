'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ago, api } from '@/components/live/client';
import { Icon } from '@/components/ui/Icon';
import { Avatar } from '@/components/social/Avatar';
import type { PostView } from '@/services/feed';
import { TaggedText } from './PostCard';
import { usePostActions } from './usePostActions';
import { becauseText } from './meta';

interface FeedData {
  now: number;
  posts: PostView[];
}

/**
 * MemoReels: one visual moment per screen, snapping as you scroll. Videos play (muted) only while on screen
 * and pause as soon as they leave it. The order is fixed when the page opens, so nothing reshuffles while
 * you watch; counts refresh after each of your own actions.
 */
export function ReelsView({ eventId, initial }: { eventId: string; initial: FeedData }) {
  const [data, setData] = useState(initial);
  const order = useRef(initial.posts.map((p) => p.id));

  const refresh = useCallback(async () => {
    try {
      const next = await api<FeedData>(`/api/events/${eventId}/feed?scope=visual`);
      const byId = new Map(next.posts.map((p) => [p.id, p]));
      // Keep the order people started watching in; drop posts that were deleted.
      setData({ now: next.now, posts: order.current.map((id) => byId.get(id)).filter((p): p is PostView => p !== undefined) });
    } catch {
      // A failed refresh keeps what is on screen; the next action tries again.
    }
  }, [eventId]);

  if (data.posts.length === 0) {
    return (
      <div className="empty">
        <strong>No memoreels yet</strong>
        <p>Pictures, videos and posts on a backdrop appear here. Share one from the feed.</p>
      </div>
    );
  }
  return (
    <div className="reels" aria-label="MemoReels">
      {data.posts.map((post) => (
        <Reel key={post.id} eventId={eventId} post={post} now={data.now} onChanged={refresh} />
      ))}
      <div className="reels__end">
        <span className="caught-up__mark" aria-hidden="true" />
        <strong>That is every memoreel for now</strong>
        <Link href={`/events/${eventId}/feed/explore`}>Explore tags</Link>
      </div>
    </div>
  );
}

function Reel({ eventId, post, now, onChanged }: { eventId: string; post: PostView; now: number; onChanged: () => Promise<void> }) {
  const { liked, likes, saved, burst, like, tap, save, share } = usePostActions(eventId, post, onChanged);
  const root = useRef<HTMLElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const [muted, setMuted] = useState(true);

  useEffect(() => {
    const el = root.current;
    const v = video.current;
    if (!el || !v) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting && entry.intersectionRatio >= 0.6) void v.play().catch(() => undefined);
        else v.pause();
      },
      { threshold: [0, 0.6, 1] },
    );
    observer.observe(el);
    return () => {
      observer.disconnect();
    };
  }, []);

  return (
    <section ref={root} className="reel" aria-label={`MemoReel by ${post.author.name}`}>
      <div className="reel__frame" onPointerUp={tap}>
        {post.media ? (
          post.media.kind === 'VIDEO' ? (
            <video ref={video} src={post.media.url} muted={muted} loop playsInline preload="metadata" aria-label={`Video by ${post.author.name}`} />
          ) : (
            <img src={post.media.url} alt={`Picture by ${post.author.name}`} loading="lazy" />
          )
        ) : (
          <div className={`reel__words backdrop backdrop--${post.backdrop ?? 'meadow'}`}>
            <TaggedText eventId={eventId} text={post.text} className="backdrop__text" />
          </div>
        )}
        {burst > 0 ? (
          <span key={burst} className="heart-burst" aria-hidden="true">
            <Icon name="heart" size={110} />
          </span>
        ) : null}
        {post.media?.kind === 'VIDEO' ? (
          <button type="button" className="reel__sound" aria-label={muted ? 'Turn sound on' : 'Mute'} aria-pressed={!muted} onClick={() => { setMuted(!muted); }}>
            {muted ? 'Sound off' : 'Sound on'}
          </button>
        ) : null}

        <div className="reel__info">
          <Link href={`/events/${eventId}/people/${post.author.id}`} className="reel__who">
            <Avatar name={post.author.name} size={34} />
            <strong>{post.author.name}</strong>
            <span>· {ago(now, post.createdAt)}</span>
          </Link>
          {post.media && post.text ? <TaggedText eventId={eventId} text={post.text} className="reel__caption" /> : null}
          {post.because.length > 0 ? <p className="reel__why">Why this: {becauseText(post.because)}</p> : null}
        </div>

        <div className="reel__rail">
          <button type="button" className={liked ? 'reel__act is-liked' : 'reel__act'} aria-pressed={liked} aria-label={liked ? 'Remove your like' : 'Like'} onClick={() => void like(!liked)}>
            <Icon name="heart" size={26} />
            <span>{likes}</span>
          </button>
          <Link className="reel__act" href={`/events/${eventId}/feed`} aria-label={`${String(post.commentCount)} comments, open in the feed`}>
            <Icon name="comment" size={26} />
            <span>{post.commentCount}</span>
          </Link>
          <button type="button" className={saved ? 'reel__act is-saved' : 'reel__act'} aria-pressed={saved} aria-label={saved ? 'Remove from saved' : 'Save'} onClick={() => void save(!saved)}>
            <Icon name="bookmark" size={24} />
          </button>
          <button type="button" className="reel__act" aria-label="Share to your feed" onClick={() => void share()}>
            <Icon name="send" size={24} />
          </button>
        </div>
      </div>
    </section>
  );
}
