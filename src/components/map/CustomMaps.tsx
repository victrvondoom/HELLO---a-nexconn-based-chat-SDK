'use client';

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { api, errorText, useLive } from '@/components/live/client';
import { useFeedback } from '@/components/ui/Feedback';
import { uploadMedia } from '@/components/moments/PostComposer';
import { usePhotoGuard } from '@/components/privacy-filter/PhotoGuard';
import type { CustomMap, CustomMapPin } from '@/domain/product';

type Source = CustomMap['source'];
type PinKind = CustomMapPin['kind'];
const PIN_LABEL: Record<PinKind, string> = { PLACE: 'Place', MEET: 'Meeting point', EXIT: 'Exit', HELP: 'Help' };

/** Draws a canvas into a PNG file, so a video frame or a sketch uploads like any picture. */
function canvasFile(canvas: HTMLCanvasElement, name: string): Promise<File> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(new File([blob], name, { type: 'image/png' }));
      else reject(new Error('Could not read the picture.'));
    }, 'image/png');
  });
}

/**
 * Make your own map: from a picture, a frame of a video, or a sketch. Tap the map to drop labelled pins, then keep
 * it private or share it with the event. Pictures go through the same upload path as Moments (privacy filter
 * included); the map record and its pins are saved by /api/events/<id>/maps, and only the owner can change them.
 */
export function CustomMaps({ eventId, viewerId }: { eventId: string; viewerId: string }) {
  const base = `/api/events/${eventId}`;
  const { toast } = useFeedback();
  const guard = usePhotoGuard(eventId);
  const { data, refresh } = useLive<{ mine: CustomMap[]; shared: CustomMap[] }>(`${base}/maps`, { mine: [], shared: [] }, 15_000);
  const [source, setSource] = useState<Source | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [pinKind, setPinKind] = useState<PinKind>('MEET');
  const [pinLabel, setPinLabel] = useState('');
  const videoRef = useRef<HTMLVideoElement>(null);
  const sketchRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);

  const all = [...data.mine, ...data.shared];
  const open = all.find((m) => m.id === openId) ?? null;
  const editable = open?.ownerId === viewerId;

  useEffect(() => () => {
    if (videoUrl) URL.revokeObjectURL(videoUrl);
  }, [videoUrl]);

  // A white sketch sheet with a faint grid, ready to draw on.
  useEffect(() => {
    const canvas = sketchRef.current;
    if (source !== 'SKETCH' || !canvas) return;
    const g = canvas.getContext('2d');
    if (!g) return;
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, canvas.width, canvas.height);
    g.strokeStyle = 'rgba(42,56,150,0.08)';
    for (let x = 0; x <= canvas.width; x += 40) g.strokeRect(x, 0, 0, canvas.height);
    for (let y = 0; y <= canvas.height; y += 40) g.strokeRect(0, y, canvas.width, 0);
  }, [source]);

  async function save(file: File) {
    if (!name.trim()) throw new Error('Give the map a name first.');
    const mediaId = await uploadMedia(base, await guard.prepare(file));
    const map = await api<CustomMap>(`${base}/maps`, 'POST', { name: name.trim(), mediaId, source });
    setSource(null);
    setName('');
    setVideoUrl(null);
    await refresh();
    setOpenId(map.id);
    toast('success', 'Map saved. Tap it to add pins.');
  }

  async function run(work: () => Promise<void>) {
    setBusy(true);
    try {
      await work();
    } catch (e: unknown) {
      toast('error', e instanceof Error && e.message ? e.message : errorText(e));
    } finally {
      setBusy(false);
    }
  }

  function captureFrame() {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return Promise.reject(new Error('Play the video to the frame you want first.'));
    const canvas = document.createElement('canvas');
    const scale = Math.min(1, 1600 / video.videoWidth);
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    canvas.getContext('2d')?.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvasFile(canvas, 'video-frame.png');
  }

  function sketch(event: ReactPointerEvent<HTMLCanvasElement>, phase: 'down' | 'move' | 'up') {
    const canvas = sketchRef.current;
    const g = canvas?.getContext('2d');
    if (!canvas || !g) return;
    const r = canvas.getBoundingClientRect();
    const x = ((event.clientX - r.left) / r.width) * canvas.width;
    const y = ((event.clientY - r.top) / r.height) * canvas.height;
    if (phase === 'down') {
      drawing.current = true;
      canvas.setPointerCapture(event.pointerId);
      g.beginPath();
      g.moveTo(x, y);
    } else if (phase === 'move' && drawing.current) {
      g.lineWidth = 4;
      g.lineCap = 'round';
      g.strokeStyle = '#1f2a78';
      g.lineTo(x, y);
      g.stroke();
    } else if (phase === 'up') {
      drawing.current = false;
    }
  }

  async function savePins(map: CustomMap, pins: CustomMapPin[]) {
    await api(`${base}/maps/${map.id}`, 'PUT', { pins });
    await refresh();
  }

  function dropPin(event: ReactPointerEvent<HTMLDivElement>) {
    if (!open || !editable || busy) return;
    const r = event.currentTarget.getBoundingClientRect();
    const pin: CustomMapPin = {
      id: `p-${Date.now().toString(36)}`,
      x: Math.min(1, Math.max(0, (event.clientX - r.left) / r.width)),
      y: Math.min(1, Math.max(0, (event.clientY - r.top) / r.height)),
      label: pinLabel.trim() || PIN_LABEL[pinKind],
      kind: pinKind,
    };
    void run(() => savePins(open, [...open.pins, pin]));
  }

  return (
    <section className="panel custom-maps" aria-labelledby="custom-maps-title">
      <header className="custom-maps__head">
        <div>
          <h2 id="custom-maps-title">Your maps</h2>
          <p className="muted small">Make a map of your own: a stall layout, a family meeting point, a route. Private until you share it.</p>
        </div>
        <div className="custom-maps__sources" role="group" aria-label="Make a map from">
          {(['IMAGE', 'VIDEO_FRAME', 'SKETCH'] as const).map((s) => (
            <button key={s} type="button" className="chip" aria-pressed={source === s} onClick={() => { setSource(source === s ? null : s); }}>
              {s === 'IMAGE' ? 'Upload a picture' : s === 'VIDEO_FRAME' ? 'Frame from a video' : 'Sketch one'}
            </button>
          ))}
        </div>
      </header>

      {source ? (
        <div className="custom-maps__maker">
          <label className="field">
            <span>Map name</span>
            <input value={name} maxLength={80} onChange={(e) => { setName(e.target.value); }} placeholder="Family meeting points" />
          </label>
          {source === 'IMAGE' ? (
            <label className="field">
              <span>Picture of the map (PNG, JPEG or WebP, up to 4 MB)</span>
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                disabled={busy}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void run(() => save(file));
                }}
              />
            </label>
          ) : null}
          {source === 'VIDEO_FRAME' ? (
            <>
              <label className="field">
                <span>Video (it stays on this device; only the frame you pick is uploaded)</span>
                <input
                  type="file"
                  accept="video/*"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) setVideoUrl(URL.createObjectURL(file));
                  }}
                />
              </label>
              {videoUrl ? <video ref={videoRef} className="custom-maps__video" src={videoUrl} controls muted playsInline /> : null}
              <button type="button" className="button" disabled={busy || !videoUrl} onClick={() => void run(async () => save(await captureFrame()))}>
                Use this frame
              </button>
            </>
          ) : null}
          {source === 'SKETCH' ? (
            <>
              <canvas
                ref={sketchRef}
                className="custom-maps__sketch"
                width={1200}
                height={800}
                aria-label="Sketch area: draw rooms, paths and landmarks"
                onPointerDown={(e) => { sketch(e, 'down'); }}
                onPointerMove={(e) => { sketch(e, 'move'); }}
                onPointerUp={(e) => { sketch(e, 'up'); }}
              />
              <button type="button" className="button" disabled={busy} onClick={() => void run(async () => { if (sketchRef.current) await save(await canvasFile(sketchRef.current, 'sketch.png')); })}>
                Save sketch
              </button>
            </>
          ) : null}
        </div>
      ) : null}

      {all.length === 0 && !source ? <p className="muted small">No maps yet. Pick one of the three ways above to make one.</p> : null}

      {all.length > 0 ? (
        <ul className="custom-maps__list">
          {all.map((m) => (
            <li key={m.id}>
              <button type="button" className="chip" aria-pressed={m.id === openId} onClick={() => { setOpenId(m.id === openId ? null : m.id); }}>
                {m.name}
                {m.ownerId !== viewerId ? ' (shared)' : m.shared ? ' · shared' : ''}
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {open ? (
        <div className="custom-maps__view">
          {editable ? (
            <div className="custom-maps__tools">
              <select value={pinKind} onChange={(e) => { setPinKind(e.target.value as PinKind); }} aria-label="Pin type">
                {(Object.keys(PIN_LABEL) as PinKind[]).map((k) => (
                  <option key={k} value={k}>
                    {PIN_LABEL[k]}
                  </option>
                ))}
              </select>
              <input value={pinLabel} maxLength={60} onChange={(e) => { setPinLabel(e.target.value); }} placeholder="Pin label, then tap the map" aria-label="Pin label" />
              <label className="custom-maps__share">
                <input type="checkbox" checked={open.shared} disabled={busy} onChange={(e) => void run(async () => { await api(`${base}/maps/${open.id}`, 'PUT', { shared: e.target.checked }); await refresh(); })} />
                Share with the event
              </label>
              <button type="button" className="button button--quiet-danger button--sm" disabled={busy} onClick={() => void run(async () => { await api(`${base}/maps/${open.id}`, 'DELETE'); setOpenId(null); await refresh(); })}>
                Delete map
              </button>
            </div>
          ) : null}
          <div className={`custom-maps__canvas${editable ? ' is-editable' : ''}`} onPointerUp={dropPin}>
            <img src={`${base}/media/${open.mediaId}`} alt={`Map: ${open.name}`} draggable={false} />
            {open.pins.map((pin) => (
              <span key={pin.id} className={`custom-pin custom-pin--${pin.kind}`} style={{ left: `${pin.x * 100}%`, top: `${pin.y * 100}%` }}>
                <span className="custom-pin__label">{pin.label}</span>
                {editable ? (
                  <button
                    type="button"
                    className="custom-pin__remove"
                    aria-label={`Remove pin ${pin.label}`}
                    onPointerUp={(e) => { e.stopPropagation(); }}
                    onClick={() => void run(() => savePins(open, open.pins.filter((p) => p.id !== pin.id)))}
                  >
                    ×
                  </button>
                ) : null}
              </span>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}
