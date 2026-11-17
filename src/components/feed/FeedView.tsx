'use client';

import Link from 'next/link';
import { useRef, useState, type SyntheticEvent } from 'react';
import { ago, api, errorText, useLive } from '@/components/live/client';
import { useFeedback } from '@/components/ui/Feedback';
import { Icon } from '@/components/ui/Icon';
import { Avatar } from '@/components/social/Avatar';
import type { PostView } from '@/services/feed';

type Scope = 'all' | 'following' | 'videos';
interface FeedData {
  now: number;
  posts: PostView[];
}
interface CommentView {
  id: string;
  author: { id: string; name: string };
  text: string;
  createdAt: number;
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
}

export function FeedView({ eventId, initial, communityId, authorId, canPost, postHint }: Props) {
  const base = `/api/events/${eventId}`;
  const [scope, setScope] = useState<Scope>('all');
  const query = new URLSearchParams({ scope });
  if (communityId) query.set('community', communityId);
  if (authorId) query.set('author', authorId);
  const { data, refresh, stale } = useLive<FeedData>(`${base}/feed?${query.toString()}`, initial, 8000);
  const { toast } = useFeedback();

  const act = async (run: () => Promise<unknown>, done?: string) => {
    try {
      await run();
      if (done) toast('success', done);
      await refresh();
    } catch (e: unknown) {
      toast('error', errorText(e));
    }
  };

  return (
    <div className="feed">
      {canPost ? <Composer base={base} communityId={communityId} onPosted={refresh} /> : postHint ? <p className="notice">{postHint}</p> : null}
      {!authorId ? (
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <nav className="segmented" aria-label="Feed views">
            {(['all', 'following', 'videos'] as const).map((s) => (
              <button key={s} type="button" className={scope === s ? 'segmented__item is-active' : 'segmented__item'} aria-pressed={scope === s} onClick={() => { setScope(s); }}>
                {s === 'all' ? 'Everyone' : s === 'following' ? 'Following' : 'Videos'}
              </button>
            ))}
          </nav>
          {stale ? <span className="stale-note" role="status">Reconnecting…</span> : null}
        </div>
      ) : null}
      {data.posts.length === 0 ? (
        <div className="empty">
          <strong>Nothing here yet</strong>
          <p>{scope === 'following' ? 'Posts from people you follow appear here.' : scope === 'videos' ? 'Videos people upload appear here.' : 'Be the first to post.'}</p>
        </div>
      ) : (
        data.posts.map((post) => (
          <article key={post.id} className="panel post" aria-label={`Post by ${post.author.name}`}>
            <PostBody eventId={eventId} post={post} now={data.now} />
            {post.repost ? (
              <div className="post__quote">
                <PostBody eventId={eventId} post={post.repost} now={data.now} />
              </div>
            ) : null}
            <PostActions
              base={base}
              post={post}
              onLike={() => act(() => api(`${base}/feed/${post.id}`, 'POST', { action: 'like', on: !post.liked }))}
              onShare={() => act(() => api(`${base}/feed`, 'POST', { text: '', repostOf: post.id, communityId: null, mediaId: null }), 'Shared to your feed.')}
              onDelete={() => act(() => api(`${base}/feed/${post.id}`, 'POST', { action: 'delete' }), 'Post deleted.')}
              onCommented={refresh}
            />
          </article>
        ))
      )}
    </div>
  );
}

function PostBody({ eventId, post, now }: { eventId: string; post: Omit<PostView, 'repost'>; now: number }) {
  return (
    <>
      <header className="post__head">
        <Avatar name={post.author.name} size={36} />
        <div>
          <Link href={`/events/${eventId}/people/${post.author.id}`}>{post.author.name}</Link>
          <div className="xs faint">
            {ago(now, post.createdAt)}
            {post.community ? (
              <>
                {' · in '}
                <Link href={`/events/${eventId}/communities/${post.community.id}`} style={{ fontWeight: 500 }}>
                  {post.community.name}
                </Link>
              </>
            ) : null}
          </div>
        </div>
      </header>
      {post.text ? <p className="post__text">{post.text}</p> : null}
      {post.media ? (
        <div className="post__media">
          {post.media.kind === 'VIDEO' ? (
            <video src={post.media.url} controls preload="metadata" playsInline aria-label={`Video posted by ${post.author.name}`} />
          ) : (
            <img src={post.media.url} alt={`Picture posted by ${post.author.name}`} loading="lazy" />
          )}
        </div>
      ) : null}
    </>
  );
}

function PostActions({ base, post, onLike, onShare, onDelete, onCommented }: { base: string; post: PostView; onLike: () => Promise<void>; onShare: () => Promise<void>; onDelete: () => Promise<void>; onCommented: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [comments, setComments] = useState<CommentView[] | null>(null);
  const { toast } = useFeedback();

  const load = async () => {
    try {
      setComments((await api<{ comments: CommentView[] }>(`${base}/feed/${post.id}`)).comments);
    } catch (e: unknown) {
      toast('error', errorText(e));
    }
  };
  const submit = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const raw = new FormData(form).get('text');
    const text = typeof raw === 'string' ? raw.trim() : '';
    if (!text) return;
    try {
      await api(`${base}/feed/${post.id}`, 'POST', { action: 'comment', text });
      form.reset();
      await Promise.all([load(), onCommented()]);
    } catch (e: unknown) {
      toast('error', errorText(e));
    }
  };

  return (
    <>
      <div className="post__actions">
        <button type="button" className="icon-button" aria-pressed={post.liked} onClick={() => void onLike()} aria-label={post.liked ? 'Remove your like' : 'Like'}>
          <Icon name="heart" /> {post.likeCount}
        </button>
        <button
          type="button"
          className="icon-button"
          aria-expanded={open}
          onClick={() => {
            setOpen(!open);
            if (!open) void load();
          }}
          aria-label="Comments"
        >
          <Icon name="comment" /> {post.commentCount}
        </button>
        <button type="button" className="icon-button" onClick={() => void onShare()}>
          <Icon name="share" /> Share
        </button>
        {post.canDelete ? (
          <button type="button" className="icon-button icon-button--danger" style={{ marginLeft: 'auto' }} onClick={() => void onDelete()}>
            <Icon name="trash" /> Delete
          </button>
        ) : null}
      </div>
      {open ? (
        <div className="comments">
          {comments === null ? <span className="small faint">Loading…</span> : comments.length === 0 ? <span className="small faint">No comments yet.</span> : null}
          {comments?.map((c) => (
            <div key={c.id} className="comment">
              <strong>{c.author.name}</strong> {c.text}
            </div>
          ))}
          <form onSubmit={(e) => void submit(e)}>
            <label className="visually-hidden" htmlFor={`c-${post.id}`}>
              Write a comment
            </label>
            <input id={`c-${post.id}`} name="text" maxLength={500} placeholder="Write a comment" autoComplete="off" />
            <button type="submit" className="button button--sm">
              Send
            </button>
          </form>
        </div>
      ) : null}
    </>
  );
}

function Composer({ base, communityId, onPosted }: { base: string; communityId?: string; onPosted: () => Promise<void> }) {
  const [text, setText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const { toast } = useFeedback();

  async function post() {
    setBusy(true);
    try {
      let mediaId: string | null = null;
      if (file) {
        // The file goes up as raw bytes; the server checks its real type and size before keeping it.
        const response = await fetch(`${base}/media`, { method: 'POST', headers: { 'content-type': file.type }, body: file });
        const body = (await response.json()) as { ok: true; data: { id: string } } | { ok: false; error: { message: string } };
        if (!body.ok) throw new Error(body.error.message);
        mediaId = body.data.id;
      }
      await api(`${base}/feed`, 'POST', { text, mediaId, communityId: communityId ?? null, repostOf: null });
      setText('');
      setFile(null);
      if (input.current) input.current.value = '';
      await onPosted();
    } catch (e: unknown) {
      toast('error', e instanceof Error && e.message ? e.message : 'Could not post. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel panel__body composer-card">
      <label className="visually-hidden" htmlFor="post-text">
        Write a post
      </label>
      <textarea id="post-text" value={text} maxLength={1000} placeholder="Share something with the event" onChange={(e) => { setText(e.target.value); }} />
      <div className="composer-card__bar">
        <input ref={input} id="post-file" type="file" className="visually-hidden" accept="image/png,image/jpeg,image/webp,image/gif,video/mp4,video/webm" onChange={(e) => { setFile(e.target.files?.[0] ?? null); }} />
        <label htmlFor="post-file" className="icon-button" style={{ border: '1px solid var(--hair)' }}>
          <Icon name="video" /> {file ? file.name.slice(0, 28) : 'Picture or video'}
        </label>
        {file ? (
          <button type="button" className="icon-button" onClick={() => { setFile(null); if (input.current) input.current.value = ''; }}>
            Remove
          </button>
        ) : null}
        <span className="xs faint" style={{ marginLeft: 'auto' }}>
          {text.length}/1000
        </span>
        <button type="button" className="button button--sm" disabled={busy || (text.trim().length === 0 && !file)} onClick={() => void post()}>
          {busy ? 'Posting…' : 'Post'}
        </button>
      </div>
    </div>
  );
}
