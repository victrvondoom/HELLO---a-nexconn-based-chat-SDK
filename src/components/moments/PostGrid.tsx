'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from '@/components/ui/Icon';
import type { PostView } from '@/services/feed';
import { PostCard } from './PostCard';

/** One square tile: the picture or video, the backdrop with its words, or the words alone. */
function Tile({ post }: { post: PostView }) {
  const shown = post.repost ?? post;
  if (shown.media) {
    return shown.media.kind === 'VIDEO' ? (
      <>
        <video src={shown.media.url} muted playsInline preload="metadata" aria-hidden="true" />
        <span className="mtile__badge" aria-hidden="true">
          <Icon name="play" size={14} />
        </span>
      </>
    ) : (
      <img src={shown.media.url} alt="" loading="lazy" />
    );
  }
  return (
    <div className={shown.backdrop ? `mtile__words backdrop backdrop--${shown.backdrop}` : 'mtile__words'}>
      <span>{shown.text}</span>
    </div>
  );
}

/**
 * A grid of posts, as on a profile or in Explore. Opening a tile shows the full post (with likes, comments
 * and saves) in a layer above the grid; Escape or the backdrop closes it.
 */
export function PostGrid({ eventId, posts, now, onChanged, empty }: { eventId: string; posts: PostView[]; now: number; onChanged: () => Promise<void>; empty: string }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const open = posts.find((p) => p.id === openId) ?? null;
  const close = useCallback(() => {
    setOpenId(null);
  }, []);

  if (posts.length === 0) {
    return (
      <div className="empty">
        <strong>Nothing here yet</strong>
        <p>{empty}</p>
      </div>
    );
  }
  return (
    <>
      <ul className="mgrid list-reset">
        {posts.map((post) => (
          <li key={post.id}>
            <button type="button" className="mtile" onClick={() => { setOpenId(post.id); }} aria-label={`Open post by ${post.author.name}: ${(post.repost ?? post).text.slice(0, 80) || 'picture or video'}`}>
              <Tile post={post} />
              <span className="mtile__stats" aria-hidden="true">
                <span>
                  <Icon name="heart" size={15} /> {post.likeCount}
                </span>
                <span>
                  <Icon name="comment" size={15} /> {post.commentCount}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      {open ? <PostLayer eventId={eventId} post={open} now={now} onChanged={onChanged} onClose={close} /> : null}
    </>
  );
}

function PostLayer({ eventId, post, now, onChanged, onClose }: { eventId: string; post: PostView; now: number; onChanged: () => Promise<void>; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
    };
  }, [onClose]);
  return (
    <div className="post-layer" role="dialog" aria-modal="true" aria-label={`Post by ${post.author.name}`}>
      <div className="post-layer__backdrop" onClick={onClose} aria-hidden="true" />
      <div className="post-layer__body">
        <button ref={closeRef} type="button" className="post-layer__close" aria-label="Close post" onClick={onClose}>
          <Icon name="close" size={20} />
        </button>
        <PostCard eventId={eventId} post={post} now={now} onChanged={onChanged} />
      </div>
    </div>
  );
}
