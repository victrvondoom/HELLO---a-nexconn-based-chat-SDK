'use client';

import Link from 'next/link';
import { useState, type SyntheticEvent } from 'react';
import { ago, api, errorText } from '@/components/live/client';
import { useFeedback } from '@/components/ui/Feedback';
import { Icon } from '@/components/ui/Icon';
import { Avatar } from '@/components/social/Avatar';
import type { PostView } from '@/services/feed';
import { becauseText, tagRuns } from './meta';
import { PollBlock } from './PollBlock';
import { usePostActions } from './usePostActions';

interface CommentView {
  id: string;
  author: { id: string; name: string };
  text: string;
  createdAt: number;
}

/** Text with #tags turned into Explore links. Plain text otherwise: nothing is rendered as HTML. */
export function TaggedText({ eventId, text, className }: { eventId: string; text: string; className?: string }) {
  return (
    <p className={className}>
      {tagRuns(text).map((run, i) =>
        run.kind === 'tag' ? (
          <Link key={i} className="tag-link" href={`/events/${eventId}/feed/explore?tag=${encodeURIComponent(run.value.toLowerCase())}`}>
            #{run.value}
          </Link>
        ) : (
          <span key={i}>{run.value}</span>
        ),
      )}
    </p>
  );
}

/** The visual part of a post: its picture or video, or its text drawn on a backdrop. */
export function PostVisual({ eventId, post, autoPlay = false }: { eventId: string; post: Omit<PostView, 'repost'>; autoPlay?: boolean }) {
  if (post.media) {
    return post.media.kind === 'VIDEO' ? (
      <video src={post.media.url} controls={!autoPlay} muted={autoPlay} autoPlay={autoPlay} loop={autoPlay} preload="metadata" playsInline aria-label={`Video posted by ${post.author.name}`} />
    ) : (
      <img src={post.media.url} alt={`Picture posted by ${post.author.name}`} loading="lazy" />
    );
  }
  if (post.backdrop) {
    return (
      <div className={`backdrop backdrop--${post.backdrop}`}>
        <TaggedText eventId={eventId} text={post.text} className="backdrop__text" />
      </div>
    );
  }
  return null;
}

/**
 * One post: who, where and when; the picture, video or backdrop (double-tap it to like); likes, comments,
 * share and save; and why the Open Feed Charter placed it here.
 */
export function PostCard({ eventId, post, now, onChanged }: { eventId: string; post: PostView; now: number; onChanged: () => Promise<void> }) {
  const base = `/api/events/${eventId}`;
  const { toast } = useFeedback();
  const { liked, likes, saved, burst, like, tap, save, share, remove } = usePostActions(eventId, post, onChanged);
  const [open, setOpen] = useState(false);
  const [comments, setComments] = useState<CommentView[] | null>(null);
  const [whyOpen, setWhyOpen] = useState(false);
  const visual = Boolean(post.media) || Boolean(post.backdrop);

  async function loadComments() {
    try {
      setComments((await api<{ comments: CommentView[] }>(`${base}/feed/${post.id}`)).comments);
    } catch (e: unknown) {
      toast('error', errorText(e));
    }
  }

  async function comment(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const raw = new FormData(form).get('text');
    const text = typeof raw === 'string' ? raw.trim() : '';
    if (!text) return;
    try {
      await api(`${base}/feed/${post.id}`, 'POST', { action: 'comment', text });
      form.reset();
      await Promise.all([loadComments(), onChanged()]);
    } catch (e: unknown) {
      toast('error', errorText(e));
    }
  }

  return (
    <article className="mpost" aria-label={`Post by ${post.author.name}`}>
      <header className="mpost__head">
        <Link href={`/events/${eventId}/people/${post.author.id}`} className="mpost__who">
          <span className="ring ring--sm">
            <Avatar name={post.author.name} size={36} />
          </span>
          <span className="mpost__name">
            <strong>{post.author.name}</strong>
            <span className="xs faint">
              {ago(now, post.createdAt)}
              {post.community ? ` · in ${post.community.name}` : ''}
            </span>
          </span>
        </Link>
        {post.because.length > 0 ? (
          <button type="button" className="why-chip" aria-expanded={whyOpen} onClick={() => { setWhyOpen(!whyOpen); }}>
            <Icon name="info" size={13} /> Why this
          </button>
        ) : null}
      </header>

      {whyOpen ? (
        <p className="why-note">
          <span>Placed here by the Open Feed Charter: {becauseText(post.because)}.</span>{' '}
          <Link href={`/events/${eventId}/feed/charter`}>See every rule</Link>
        </p>
      ) : null}

      {post.repost ? (
        <div className="mpost__quote">
          <p className="xs faint">Shared from {post.repost.author.name}</p>
          {post.repost.media || post.repost.backdrop ? (
            <div className="mpost__visual">
              <PostVisual eventId={eventId} post={post.repost} />
            </div>
          ) : null}
          {!post.repost.backdrop && post.repost.text ? <TaggedText eventId={eventId} text={post.repost.text} className="mpost__text" /> : null}
        </div>
      ) : null}

      {visual ? (
        <div className="mpost__visual" onPointerUp={tap} onDoubleClick={(e) => { e.preventDefault(); }}>
          <PostVisual eventId={eventId} post={post} />
          {burst > 0 ? (
            <span key={burst} className="heart-burst" aria-hidden="true">
              <Icon name="heart" size={96} />
            </span>
          ) : null}
        </div>
      ) : null}

      {!post.backdrop && post.text ? <TaggedText eventId={eventId} text={post.text} className="mpost__text" /> : null}

      {post.poll ? <PollBlock eventId={eventId} postId={post.id} poll={post.poll} now={now} onChanged={onChanged} /> : null}

      <div className="mpost__actions">
        <button type="button" className={liked ? 'mbtn mbtn--liked' : 'mbtn'} aria-pressed={liked} aria-label={liked ? 'Remove your like' : 'Like'} onClick={() => void like(!liked)}>
          <Icon name="heart" size={22} />
        </button>
        <button
          type="button"
          className="mbtn"
          aria-expanded={open}
          aria-label="Comments"
          onClick={() => {
            setOpen(!open);
            if (!open) void loadComments();
          }}
        >
          <Icon name="comment" size={22} />
        </button>
        <button type="button" className="mbtn" aria-label="Share to your feed" onClick={() => void share()}>
          <Icon name="send" size={21} />
        </button>
        <span className="grow" />
        {post.canDelete ? (
          <button type="button" className="mbtn mbtn--quiet" aria-label="Delete post" onClick={() => void remove()}>
            <Icon name="trash" size={19} />
          </button>
        ) : null}
        <button type="button" className={saved ? 'mbtn mbtn--saved' : 'mbtn'} aria-pressed={saved} aria-label={saved ? 'Remove from saved' : 'Save'} onClick={() => void save(!saved)}>
          <Icon name="bookmark" size={21} />
        </button>
      </div>

      <div className="mpost__meta">
        <strong>
          {likes} {likes === 1 ? 'like' : 'likes'}
        </strong>
        {post.commentCount > 0 && !open ? (
          <button
            type="button"
            className="link-button"
            onClick={() => {
              setOpen(true);
              void loadComments();
            }}
          >
            View {post.commentCount === 1 ? 'the comment' : `all ${post.commentCount} comments`}
          </button>
        ) : null}
      </div>

      {open ? (
        <div className="mpost__comments">
          {comments === null ? <span className="small faint">Loading…</span> : comments.length === 0 ? <span className="small faint">No comments yet. Say something kind.</span> : null}
          {comments?.map((c) => (
            <p key={c.id} className="mcomment">
              <Link href={`/events/${eventId}/people/${c.author.id}`}>{c.author.name}</Link> {c.text}
            </p>
          ))}
          <form className="mcomment-form" onSubmit={(e) => void comment(e)}>
            <label className="visually-hidden" htmlFor={`c-${post.id}`}>
              Write a comment
            </label>
            <input id={`c-${post.id}`} name="text" maxLength={500} placeholder="Add a comment…" autoComplete="off" />
            <button type="submit" className="button button--sm">
              Post
            </button>
          </form>
        </div>
      ) : null}
    </article>
  );
}
