'use client';

import { useEffect, useRef, useState } from 'react';
import { api, errorText } from '@/components/live/client';
import { useFeedback } from '@/components/ui/Feedback';
import { Icon } from '@/components/ui/Icon';
import { BACKDROPS, type Backdrop } from '@/domain/product';
import { BACKDROP_LABEL } from './meta';
import { uploadMedia } from './PostComposer';

const STORY_MAX = 200;

export interface Place {
  id: string;
  name: string;
}

/**
 * Make a story: words on a backdrop, or a picture or video with a caption. Optionally pin it to a place in
 * the venue (a place you choose, never your location) and choose who sees it. It is gone after 24 hours.
 */
export function StoryComposer({ eventId, places, onClose, onShared }: { eventId: string; places: Place[]; onClose: () => void; onShared: () => Promise<void> }) {
  const base = `/api/events/${eventId}`;
  const { toast } = useFeedback();
  const [mode, setMode] = useState<'TEXT' | 'MEDIA'>('TEXT');
  const [text, setText] = useState('');
  const [backdrop, setBackdrop] = useState<Backdrop>('meadow');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [spaceId, setSpaceId] = useState('');
  const [audience, setAudience] = useState<'EVENT' | 'FOLLOWERS'>('EVENT');
  const [busy, setBusy] = useState(false);
  const first = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    first.current?.focus();
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

  useEffect(() => {
    if (!file) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => {
      URL.revokeObjectURL(url);
    };
  }, [file]);

  const ready = mode === 'TEXT' ? text.trim().length > 0 : file !== null;

  async function share() {
    setBusy(true);
    try {
      const mediaId = mode === 'MEDIA' && file ? await uploadMedia(base, file) : null;
      const kind = mode === 'TEXT' ? 'TEXT' : file?.type.startsWith('video/') ? 'VIDEO' : 'IMAGE';
      await api(`${base}/moments/stories`, 'POST', { kind, text, backdrop, mediaId, spaceId: spaceId || null, audience });
      toast('success', 'Shared. Your story disappears in 24 hours.');
      onClose();
      await onShared();
    } catch (e: unknown) {
      toast('error', e instanceof Error && e.message ? e.message : errorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="story-viewer" role="dialog" aria-modal="true" aria-label="New story">
      <div className="story-viewer__backdrop" onClick={onClose} aria-hidden="true" />
      <div className="story-stage story-stage--compose">
        <header className="story-head">
          <strong className="story-compose__title">New story</strong>
          <div className="story-compose__modes" role="tablist" aria-label="Story type">
            <button type="button" role="tab" aria-selected={mode === 'TEXT'} className={mode === 'TEXT' ? 'is-on' : ''} onClick={() => { setMode('TEXT'); }}>
              Words
            </button>
            <button type="button" role="tab" aria-selected={mode === 'MEDIA'} className={mode === 'MEDIA' ? 'is-on' : ''} onClick={() => { setMode('MEDIA'); }}>
              Photo or video
            </button>
          </div>
          <button type="button" className="story-icon" aria-label="Close the story editor" onClick={onClose}>
            <Icon name="close" size={22} />
          </button>
        </header>

        <div className={mode === 'TEXT' || !preview ? `story-card backdrop backdrop--${backdrop}` : 'story-card'}>
          {mode === 'MEDIA' && preview && file ? (
            file.type.startsWith('video/') ? <video src={preview} muted autoPlay loop playsInline /> : <img src={preview} alt="Your story picture" />
          ) : null}
          {mode === 'MEDIA' && !file ? (
            <label htmlFor="story-file" className="story-pick">
              <Icon name="camera" size={34} />
              <span>Choose a picture or video</span>
              <span className="xs">PNG, JPEG, WebP, GIF up to 4 MB · MP4 or WebM up to 24 MB</span>
            </label>
          ) : null}
          <label className="visually-hidden" htmlFor="story-text">
            {mode === 'TEXT' ? 'Story text' : 'Caption'}
          </label>
          <textarea
            ref={first}
            id="story-text"
            className={mode === 'TEXT' ? 'story-card__input backdrop__text' : 'story-card__input story-card__input--caption'}
            value={text}
            maxLength={STORY_MAX}
            placeholder={mode === 'TEXT' ? 'Say something…' : 'Add a caption'}
            onChange={(e) => {
              setText(e.target.value);
            }}
          />
          <input
            id="story-file"
            type="file"
            className="visually-hidden"
            accept="image/png,image/jpeg,image/webp,image/gif,video/mp4,video/webm"
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
            }}
          />
        </div>

        <div className="story-compose__controls">
          {mode === 'TEXT' ? (
            <div className="bswatch-row bswatch-row--dark" role="radiogroup" aria-label="Backdrop">
              {BACKDROPS.map((b) => (
                <button key={b} type="button" role="radio" aria-checked={backdrop === b} className={`bswatch backdrop--${b}`} title={BACKDROP_LABEL[b]} onClick={() => { setBackdrop(b); }}>
                  <span className="visually-hidden">{BACKDROP_LABEL[b]}</span>
                </button>
              ))}
            </div>
          ) : file ? (
            <label htmlFor="story-file" className="story-pill">
              <Icon name="camera" size={16} /> Change file
            </label>
          ) : null}
          <div className="story-compose__row">
            <label className="story-field">
              <span>
                <Icon name="pin" size={14} /> Place
              </span>
              <select
                value={spaceId}
                onChange={(e) => {
                  setSpaceId(e.target.value);
                }}
              >
                <option value="">No place</option>
                {places.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="story-field">
              <span>
                <Icon name="people" size={14} /> Who sees it
              </span>
              <select
                value={audience}
                onChange={(e) => {
                  setAudience(e.target.value === 'FOLLOWERS' ? 'FOLLOWERS' : 'EVENT');
                }}
              >
                <option value="EVENT">Everyone at the event</option>
                <option value="FOLLOWERS">Only my followers</option>
              </select>
            </label>
          </div>
          <div className="story-compose__row story-compose__row--end">
            <span className="xs story-compose__count">
              {text.length}/{STORY_MAX} · gone in 24 hours
            </span>
            <button type="button" className="button button--sun" disabled={busy || !ready} onClick={() => void share()}>
              {busy ? 'Sharing…' : 'Share story'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
