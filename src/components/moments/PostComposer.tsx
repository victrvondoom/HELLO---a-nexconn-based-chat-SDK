'use client';

import { useEffect, useRef, useState } from 'react';
import { api } from '@/components/live/client';
import { useFeedback } from '@/components/ui/Feedback';
import { Icon } from '@/components/ui/Icon';
import { BACKDROPS, type Backdrop } from '@/domain/product';
import { BACKDROP_LABEL } from './meta';

const POST_MAX = 1000;

/** Uploads a picture or video as raw bytes; the server checks its real type and size before keeping it. */
export async function uploadMedia(base: string, file: File): Promise<string> {
  const response = await fetch(`${base}/media`, { method: 'POST', headers: { 'content-type': file.type }, body: file });
  const body = (await response.json().catch(() => null)) as { ok: true; data: { id: string } } | { ok: false; error: { message: string } } | null;
  if (!body) throw new Error('The upload did not finish. Try again.');
  if (!body.ok) throw new Error(body.error.message);
  return body.data.id;
}

/**
 * Write a post: text, text on a backdrop, or a picture or video with a caption. It starts as one calm line
 * and opens when tapped, so the feed is not pushed down by an empty form.
 */
export function PostComposer({ eventId, communityId, onPosted, autoOpen = false }: { eventId: string; communityId?: string; onPosted: () => Promise<void>; autoOpen?: boolean }) {
  const base = `/api/events/${eventId}`;
  const [open, setOpen] = useState(autoOpen);
  const [text, setText] = useState('');
  const [backdrop, setBackdrop] = useState<Backdrop | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const { toast } = useFeedback();

  useEffect(() => {
    if (open) area.current?.focus();
  }, [open]);

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

  function reset() {
    setText('');
    setBackdrop(null);
    setFile(null);
    if (input.current) input.current.value = '';
  }

  async function post() {
    setBusy(true);
    try {
      const mediaId = file ? await uploadMedia(base, file) : null;
      await api(`${base}/feed`, 'POST', { text, mediaId, communityId: communityId ?? null, repostOf: null, backdrop: mediaId ? null : backdrop });
      reset();
      setOpen(false);
      toast('success', 'Posted.');
      await onPosted();
    } catch (e: unknown) {
      toast('error', e instanceof Error && e.message ? e.message : 'Could not post. Try again.');
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button type="button" className="composer-teaser" onClick={() => { setOpen(true); }}>
        <span className="composer-teaser__icon" aria-hidden="true">
          <Icon name="plus" size={18} />
        </span>
        <span className="grow">Share something with the event…</span>
        <span className="composer-teaser__hint" aria-hidden="true">
          <Icon name="camera" size={18} />
        </span>
      </button>
    );
  }

  const onBackdrop = backdrop !== null && file === null;
  return (
    <div className="pcomposer">
      <label className="visually-hidden" htmlFor="post-text">
        Write a post
      </label>
      <div className={onBackdrop ? `pcomposer__canvas backdrop backdrop--${backdrop}` : 'pcomposer__canvas'}>
        <textarea
          ref={area}
          id="post-text"
          value={text}
          maxLength={POST_MAX}
          placeholder={onBackdrop ? 'Say it big…' : 'What is happening? Use #tags so people can find it.'}
          onChange={(e) => {
            setText(e.target.value);
          }}
        />
      </div>
      {preview && file ? (
        <div className="pcomposer__preview">
          {file.type.startsWith('video/') ? <video src={preview} muted playsInline controls /> : <img src={preview} alt="Your picture, ready to post" />}
          <button
            type="button"
            className="icon-button"
            onClick={() => {
              setFile(null);
              if (input.current) input.current.value = '';
            }}
          >
            <Icon name="close" size={16} /> Remove
          </button>
        </div>
      ) : null}
      {file === null ? (
        <div className="swatches" role="radiogroup" aria-label="Backdrop">
          <button type="button" role="radio" aria-checked={backdrop === null} className="swatch swatch--none" onClick={() => { setBackdrop(null); }}>
            <span className="visually-hidden">No backdrop</span>
          </button>
          {BACKDROPS.map((b) => (
            <button key={b} type="button" role="radio" aria-checked={backdrop === b} className={`swatch backdrop--${b}`} title={BACKDROP_LABEL[b]} onClick={() => { setBackdrop(b); }}>
              <span className="visually-hidden">{BACKDROP_LABEL[b]}</span>
            </button>
          ))}
        </div>
      ) : null}
      <div className="pcomposer__bar">
        <input
          ref={input}
          id="post-file"
          type="file"
          className="visually-hidden"
          accept="image/png,image/jpeg,image/webp,image/gif,video/mp4,video/webm"
          onChange={(e) => {
            setFile(e.target.files?.[0] ?? null);
          }}
        />
        <label htmlFor="post-file" className="icon-button icon-button--outline">
          <Icon name="camera" size={17} /> {file ? 'Change file' : 'Picture or video'}
        </label>
        <span className="grow" />
        <span className="xs faint">
          {text.length}/{POST_MAX}
        </span>
        <button
          type="button"
          className="button button--ghost button--sm"
          onClick={() => {
            reset();
            setOpen(false);
          }}
        >
          Cancel
        </button>
        <button type="button" className="button button--sm" disabled={busy || (text.trim().length === 0 && !file)} onClick={() => void post()}>
          {busy ? 'Posting…' : 'Post'}
        </button>
      </div>
    </div>
  );
}
