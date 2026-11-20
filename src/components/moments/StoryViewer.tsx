'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ago, api, errorText } from '@/components/live/client';
import { useFeedback } from '@/components/ui/Feedback';
import { Icon } from '@/components/ui/Icon';
import { Avatar } from '@/components/social/Avatar';
import { REACTION_IDS, type ReactionId } from '@/domain/product';
import type { RingView, StoryView, StoryViewer as Viewer } from '@/services/moments';
import { REACTION_EMOJI, REACTION_LABEL } from './meta';

const STILL_MS = 6000;
const VIDEO_MAX_MS = 30_000;

interface Position {
  ring: number;
  story: number;
}

/** The first story in a ring that the viewer has not seen, or the first story. */
export function startOf(ring: RingView | undefined): number {
  if (!ring) return 0;
  const unseen = ring.stories.findIndex((s) => !s.seen);
  return unseen === -1 ? 0 : unseen;
}

/**
 * Full-screen stories. Tap the right side (or →) for the next story, the left side (or ←) for the previous
 * one; press and hold (or Space) to pause; Escape closes. Each story is marked seen once (a read receipt in
 * Nexconn terms). Timing is a CSS animation on the active bar, so nothing ticks in JavaScript.
 */
export function StoryViewer({
  eventId,
  rings,
  start,
  now,
  onClose,
  onChanged,
}: {
  eventId: string;
  rings: RingView[];
  start: Position;
  now: number;
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const base = `/api/events/${eventId}`;
  const { toast, confirm } = useFeedback();
  const [pos, setPos] = useState<Position>(start);
  const [paused, setPaused] = useState(false);
  const [duration, setDuration] = useState(STILL_MS);
  const [reaction, setReaction] = useState<Record<string, ReactionId | null>>({});
  const [floater, setFloater] = useState<{ key: number; emoji: string } | null>(null);
  const [panel, setPanel] = useState<'viewers' | 'highlight' | null>(null);
  const [viewers, setViewers] = useState<Viewer[] | null>(null);
  const [title, setTitle] = useState('');
  const viewed = useRef(new Set<string>());
  const video = useRef<HTMLVideoElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);

  const ring = rings[pos.ring];
  const story: StoryView | undefined = ring?.stories[pos.story];
  const halted = paused || panel !== null;

  const next = useCallback(() => {
    setPanel(null);
    setPos((p) => {
      const current = rings[p.ring];
      if (current && p.story + 1 < current.stories.length) return { ring: p.ring, story: p.story + 1 };
      for (let r = p.ring + 1; r < rings.length; r += 1) {
        const candidate = rings[r];
        if (candidate && candidate.stories.length > 0) return { ring: r, story: startOf(candidate) };
      }
      onClose();
      return p;
    });
  }, [rings, onClose]);

  const previous = useCallback(() => {
    setPanel(null);
    setPos((p) => {
      if (p.story > 0) return { ring: p.ring, story: p.story - 1 };
      for (let r = p.ring - 1; r >= 0; r -= 1) {
        const candidate = rings[r];
        if (candidate && candidate.stories.length > 0) return { ring: r, story: 0 };
      }
      return p;
    });
  }, [rings]);

  // Mark each story seen once, the first time it is shown. Your own views are not recorded by the server.
  useEffect(() => {
    if (!story || viewed.current.has(story.id)) return;
    viewed.current.add(story.id);
    setDuration(story.kind === 'VIDEO' ? VIDEO_MAX_MS : STILL_MS);
    if (!story.seen) void api(`${base}/moments/stories/${story.id}`, 'POST', { action: 'view' }).catch(() => undefined);
  }, [story, base]);

  useEffect(() => {
    const v = video.current;
    if (!v) return;
    if (halted) v.pause();
    else void v.play().catch(() => undefined);
  }, [halted, story?.id]);

  useEffect(() => {
    closeButton.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement) return;
      if (event.key === 'Escape') onClose();
      else if (event.key === 'ArrowRight') next();
      else if (event.key === 'ArrowLeft') previous();
      else if (event.key === ' ') {
        event.preventDefault();
        setPaused((v) => !v);
      }
    };
    document.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
    };
  }, [next, previous, onClose]);

  if (!ring || !story) return null;
  const mine = ring.isYou;
  const myReaction = story.id in reaction ? (reaction[story.id] ?? null) : story.myReaction;

  async function react(id: ReactionId) {
    if (!story) return;
    const off = myReaction === id;
    setReaction((r) => ({ ...r, [story.id]: off ? null : id }));
    if (!off) setFloater({ key: Date.now(), emoji: REACTION_EMOJI[id] });
    try {
      await api(`${base}/moments/stories/${story.id}`, 'POST', off ? { action: 'unreact' } : { action: 'react', reactionId: id });
    } catch (e: unknown) {
      setReaction((r) => ({ ...r, [story.id]: myReaction }));
      toast('error', errorText(e));
    }
  }

  async function openViewers() {
    if (!story) return;
    setPanel('viewers');
    setViewers(null);
    try {
      setViewers((await api<{ viewers: Viewer[] }>(`${base}/moments/stories/${story.id}`)).viewers);
    } catch (e: unknown) {
      toast('error', errorText(e));
    }
  }

  async function remove() {
    if (!story) return;
    setPanel(null);
    setPaused(true);
    const ok = await confirm({ title: 'Delete this story?', body: 'It disappears for everyone straight away.', confirmLabel: 'Delete story', tone: 'danger' });
    setPaused(false);
    if (!ok) return;
    try {
      await api(`${base}/moments/stories/${story.id}`, 'POST', { action: 'delete' });
      toast('success', 'Story deleted.');
      onClose();
      await onChanged();
    } catch (e: unknown) {
      toast('error', errorText(e));
    }
  }

  async function keep() {
    if (!story) return;
    try {
      await api(`${base}/moments/highlights`, 'POST', { title: title.trim() || 'Highlights', storyIds: [story.id] });
      toast('success', 'Kept in a highlight on your profile.');
      setPanel(null);
      setTitle('');
    } catch (e: unknown) {
      toast('error', errorText(e));
    }
  }

  return (
    <div className="story-viewer" role="dialog" aria-modal="true" aria-label={`Story by ${ring.author.name}`}>
      <div className="story-viewer__backdrop" onClick={onClose} aria-hidden="true" />
      <div className="story-stage">
        <div className="story-bars" aria-hidden="true">
          {ring.stories.map((s, i) => (
            <span key={s.id} className={i < pos.story ? 'story-bar is-done' : i === pos.story ? 'story-bar is-active' : 'story-bar'}>
              {i === pos.story ? (
                <span
                  key={`${s.id}-${String(duration)}`}
                  className="story-bar__fill"
                  style={{ animationDuration: `${String(duration)}ms`, animationPlayState: halted ? 'paused' : 'running' }}
                  onAnimationEnd={next}
                />
              ) : null}
            </span>
          ))}
        </div>
        <p className="visually-hidden" aria-live="polite">
          Story {pos.story + 1} of {ring.stories.length} by {ring.author.name}
          {story.text ? `: ${story.text}` : ''}
        </p>

        <header className="story-head">
          <Link href={`/events/${eventId}/people/${ring.author.id}`} className="story-head__who">
            <Avatar name={ring.author.name} size={34} />
            <span>
              <strong>{mine ? 'Your story' : ring.author.name}</strong>
              <span className="story-head__meta">
                {ago(now, story.createdAt)}
                {story.audience === 'FOLLOWERS' ? ' · followers' : ''}
              </span>
            </span>
          </Link>
          <button type="button" className="story-icon" aria-label={halted ? 'Play' : 'Pause'} onClick={() => { setPaused((v) => !v); }}>
            <Icon name={halted ? 'play' : 'pause'} size={20} />
          </button>
          <button ref={closeButton} type="button" className="story-icon" aria-label="Close stories" onClick={onClose}>
            <Icon name="close" size={22} />
          </button>
        </header>

        <div
          className={story.media ? 'story-card' : `story-card backdrop backdrop--${story.backdrop}`}
          onPointerDown={() => {
            setPaused(true);
          }}
          onPointerUp={() => {
            setPaused(false);
          }}
          onPointerLeave={() => {
            setPaused(false);
          }}
        >
          {story.media ? (
            story.media.kind === 'VIDEO' ? (
              <video
                ref={video}
                key={story.id}
                src={story.media.url}
                autoPlay
                muted
                playsInline
                onLoadedMetadata={(e) => {
                  const ms = Math.round(e.currentTarget.duration * 1000);
                  if (Number.isFinite(ms) && ms > 0) setDuration(Math.min(ms, VIDEO_MAX_MS));
                }}
                aria-label={`Video story by ${ring.author.name}`}
              />
            ) : (
              <img src={story.media.url} alt={`Story picture by ${ring.author.name}`} />
            )
          ) : null}
          {story.text ? <p className={story.media ? 'story-card__caption' : 'backdrop__text story-card__text'}>{story.text}</p> : null}
          {story.space ? (
            <Link className="story-place" href={`/events/${eventId}/map?to=${encodeURIComponent(story.space.id)}`} onPointerDown={(e) => { e.stopPropagation(); }}>
              <Icon name="pin" size={14} /> {story.space.name} · directions
            </Link>
          ) : null}
          <button type="button" className="story-tap story-tap--prev" aria-label="Previous story" onClick={previous} />
          <button type="button" className="story-tap story-tap--next" aria-label="Next story" onClick={next} />
          {floater ? (
            <span key={floater.key} className="story-floater" aria-hidden="true">
              {floater.emoji}
            </span>
          ) : null}
        </div>

        <footer className="story-foot">
          {mine ? (
            <div className="story-tools">
              <button type="button" className="story-pill" onClick={() => void openViewers()}>
                <Icon name="people" size={16} /> Seen by {story.viewCount ?? 0}
                {story.reactionCount ? ` · ${String(story.reactionCount)} reactions` : ''}
              </button>
              <button
                type="button"
                className="story-pill"
                onClick={() => {
                  setPanel(panel === 'highlight' ? null : 'highlight');
                }}
              >
                <Icon name="bookmark" size={16} /> Keep
              </button>
              <button type="button" className="story-pill story-pill--danger" onClick={() => void remove()}>
                <Icon name="trash" size={16} /> Delete
              </button>
            </div>
          ) : (
            <div className="story-react">
              <Link className="story-reply" href={`/events/${eventId}/messages/${ring.author.id}`}>
                <Icon name="lock" size={15} /> Reply privately to {ring.author.name.replace(/\s*\(.*\)$/, '')}
              </Link>
              <div className="story-reactions" role="group" aria-label="React">
                {REACTION_IDS.map((id) => (
                  <button key={id} type="button" className={myReaction === id ? 'story-emoji is-on' : 'story-emoji'} aria-pressed={myReaction === id} aria-label={REACTION_LABEL[id]} onClick={() => void react(id)}>
                    {REACTION_EMOJI[id]}
                  </button>
                ))}
              </div>
            </div>
          )}
          <p className="story-nexconn" title="Nexconn is not connected in this build; this is the message the story maps to.">
            {story.nexconn.messageType} · {story.nexconn.channel}
          </p>
        </footer>

        {panel === 'viewers' ? (
          <div className="story-panel" role="region" aria-label="Seen by">
            <div className="story-panel__head">
              <strong>Seen by</strong>
              <button type="button" className="story-icon" aria-label="Close the viewer list" onClick={() => { setPanel(null); }}>
                <Icon name="close" size={18} />
              </button>
            </div>
            {viewers === null ? <p className="small">Loading…</p> : viewers.length === 0 ? <p className="small">Nobody yet. Views appear here as people watch.</p> : null}
            <ul className="list-reset story-panel__list">
              {viewers?.map((v) => (
                <li key={v.user.id}>
                  <Avatar name={v.user.name} size={30} />
                  <span className="grow">{v.user.name}</span>
                  {v.reactionId ? <span aria-label={REACTION_LABEL[v.reactionId]}>{REACTION_EMOJI[v.reactionId]}</span> : null}
                  <span className="xs">{ago(now, v.at)}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {panel === 'highlight' ? (
          <form
            className="story-panel"
            aria-label="Keep in a highlight"
            onSubmit={(e) => {
              e.preventDefault();
              void keep();
            }}
          >
            <label htmlFor="highlight-title" className="small">
              Keep this story on your profile after it expires
            </label>
            <div className="row">
              <input id="highlight-title" value={title} maxLength={24} placeholder="Highlight name, e.g. Day one" onChange={(e) => { setTitle(e.target.value); }} />
              <button type="submit" className="button button--sun button--sm">
                Keep
              </button>
            </div>
          </form>
        ) : null}
      </div>
    </div>
  );
}
