'use client';

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { api, errorText } from '@/components/live/client';
import { uploadMedia } from '@/components/moments/PostComposer';
import { useFeedback } from '@/components/ui/Feedback';
import type { Box } from '@/domain/privacy-filter/geometry';
import type { PrivacyFilterSettings } from '@/domain/privacy-filter/settings';
import type { DetectedPhoto, DetectionKind } from './engine/photo';
import type { VideoProgress } from './engine/video';
import { photoSummary, videoSummary } from './PhotoGuard';

const KIND_LABEL: Record<DetectionKind, string> = { face: 'face or head', kept: 'person you chose (kept visible)', qr: 'QR code', phone: 'phone number' };

/** Rectangles drawn over a picture or a paused video, in the media's own pixels. */
function Regions({ width, height, boxes, detections, exclude, onAdd }: { width: number; height: number; boxes: Box[]; detections: Array<{ id: string; kind: DetectionKind; box: Box }>; exclude: ReadonlySet<string>; onAdd: (b: Box) => void }) {
  const svg = useRef<SVGSVGElement>(null);
  const [draft, setDraft] = useState<Box | null>(null);
  const start = useRef<[number, number] | null>(null);
  const point = (e: ReactPointerEvent): [number, number] => {
    const r = svg.current?.getBoundingClientRect();
    if (!r) return [0, 0];
    return [Math.max(0, Math.min(width, ((e.clientX - r.left) / r.width) * width)), Math.max(0, Math.min(height, ((e.clientY - r.top) / r.height) * height))];
  };
  const box = (a: [number, number], b: [number, number]): Box => [Math.round(Math.min(a[0], b[0])), Math.round(Math.min(a[1], b[1])), Math.round(Math.max(a[0], b[0])), Math.round(Math.max(a[1], b[1]))];
  return (
    <svg
      ref={svg}
      className="pf-regions"
      viewBox={`0 0 ${String(width)} ${String(height)}`}
      preserveAspectRatio="none"
      role="img"
      aria-label="Drag on the picture to mark an area that must be hidden"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        start.current = point(e);
        setDraft(null);
      }}
      onPointerMove={(e) => {
        if (start.current) setDraft(box(start.current, point(e)));
      }}
      onPointerUp={(e) => {
        const from = start.current;
        start.current = null;
        setDraft(null);
        if (!from) return;
        const b = box(from, point(e));
        if (b[2] - b[0] >= 8 && b[3] - b[1] >= 8) onAdd(b);
      }}
    >
      {detections.map((d) => (
        <rect key={d.id} x={d.box[0]} y={d.box[1]} width={d.box[2] - d.box[0]} height={d.box[3] - d.box[1]} className={`pf-regions__${exclude.has(d.id) ? 'off' : d.kind}`} vectorEffect="non-scaling-stroke" />
      ))}
      {[...boxes, ...(draft ? [draft] : [])].map((b, i) => (
        <rect key={`m${String(i)}`} x={b[0]} y={b[1]} width={b[2] - b[0]} height={b[3] - b[1]} className="pf-regions__manual" vectorEffect="non-scaling-stroke" />
      ))}
    </svg>
  );
}

interface Result {
  file: File;
  url: string;
  summary: string;
}

/**
 * Protect a picture or a video on this device (upstream's file redaction, in HELLO): automatic detection, a review
 * where false alarms can be left visible and areas hidden by hand, the chosen effect, a preview, then download or
 * post to Moments. Nothing reaches HELLO's server until the person posts the protected copy.
 */
export function MediaTool({ eventId, settings, gallery }: { eventId: string; settings: PrivacyFilterSettings; gallery: number[][] }) {
  const { toast } = useFeedback();
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [detected, setDetected] = useState<DetectedPhoto | null>(null);
  const [exclude, setExclude] = useState<Set<string>>(new Set());
  const [manual, setManual] = useState<Box[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState<VideoProgress | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [caption, setCaption] = useState('');
  const [failure, setFailure] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const isVideo = file?.type.startsWith('video/') ?? false;

  useEffect(
    () => () => {
      abort.current?.abort();
    },
    [],
  );
  useEffect(
    () => () => {
      if (url) URL.revokeObjectURL(url);
    },
    [url],
  );
  useEffect(
    () => () => {
      if (result) URL.revokeObjectURL(result.url);
    },
    [result],
  );

  async function choose(next: File | undefined) {
    abort.current?.abort();
    setResult(null);
    setDetected(null);
    setExclude(new Set());
    setManual([]);
    setFailure(null);
    setSize(null);
    setFile(next ?? null);
    setUrl(next ? URL.createObjectURL(next) : null);
    if (!next) return;
    if (next.type === 'image/gif') {
      setFailure('Animated GIFs cannot be checked. Convert it to a video first.');
      return;
    }
    if (next.type.startsWith('image/')) {
      setBusy('Finding faces, people, QR codes and phone numbers on this device…');
      try {
        const { detectPhoto } = await import('./engine/photo');
        const d = await detectPhoto(next, settings, gallery);
        setDetected(d);
        setSize({ w: d.width, h: d.height });
        if (d.report.failedClosed) setFailure(`${d.report.errors.join(' ')} The whole picture will be hidden.`);
      } catch (e: unknown) {
        setFailure(e instanceof Error ? e.message : 'That picture could not be read.');
      } finally {
        setBusy(null);
      }
    }
  }

  async function protect() {
    if (!file) return;
    setFailure(null);
    setResult(null);
    try {
      if (detected) {
        setBusy('Hiding…');
        const { renderPhoto } = await import('./engine/photo');
        const out = await renderPhoto(detected, { exclude, manual, effect: settings.effect, name: file.name });
        setResult({ file: out.file, url: URL.createObjectURL(out.file), summary: photoSummary(out.report) });
        return;
      }
      if (isVideo) {
        setBusy('Checking every frame on this device…');
        abort.current = new AbortController();
        const { protectVideo } = await import('./engine/video');
        setProgress({ frame: 0, total: 1, fps: 0 });
        const out = await protectVideo(file, { settings, gallery, manual, effect: settings.effect, onProgress: setProgress, signal: abort.current.signal });
        setResult({ file: out.file, url: URL.createObjectURL(out.file), summary: videoSummary(out.report) });
      }
    } catch (e: unknown) {
      setFailure(e instanceof DOMException && e.name === 'AbortError' ? 'Stopped. Nothing was saved.' : `${e instanceof Error ? e.message : 'Protection failed.'} Nothing was saved or sent.`);
    } finally {
      setBusy(null);
      setProgress(null);
      abort.current = null;
    }
  }

  async function post() {
    if (!result) return;
    setBusy('Posting…');
    try {
      const base = `/api/events/${eventId}`;
      const mediaId = await uploadMedia(base, { file: result.file, privacy: 'protected' });
      await api(`${base}/feed`, 'POST', { text: caption, mediaId, communityId: null, repostOf: null, backdrop: null, poll: null });
      toast('success', 'Posted the protected copy to Moments.');
      setCaption('');
    } catch (e: unknown) {
      toast('error', errorText(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="stack">
      <label className="button button--ghost pf-file">
        Choose a picture or video
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif,video/mp4,video/webm"
          disabled={busy !== null}
          onChange={(e) => {
            void choose(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
      </label>
      {file && url ? (
        <>
          <div className="pf-canvas">
            {isVideo ? (
              <video
                src={url}
                controls
                playsInline
                muted
                aria-label="Original video (stays on this device)"
                onLoadedMetadata={(e) => {
                  setSize({ w: e.currentTarget.videoWidth, h: e.currentTarget.videoHeight });
                }}
              />
            ) : (
              <img src={url} alt="Original picture (stays on this device)" />
            )}
            {size && !busy ? (
              <Regions
                width={size.w}
                height={size.h}
                boxes={manual}
                detections={detected?.detections ?? []}
                exclude={exclude}
                onAdd={(b) => {
                  setManual((m) => [...m, b]);
                }}
              />
            ) : null}
          </div>
          <p className="xs muted">
            {isVideo ? 'Drag on the video to mark areas to hide in every frame (for example a whiteboard). Faces, people, codes and numbers are found automatically when you start.' : 'Coloured boxes are what the filter found. Drag to mark more areas to hide.'}
          </p>
        </>
      ) : null}
      {detected?.detections.length ? (
        <fieldset className="pf-found">
          <legend className="small">Found ({detected.detections.length})</legend>
          {detected.detections.map((d) =>
            d.kind === 'kept' ? (
              <p key={d.id} className="xs muted">
                A {KIND_LABEL.kept}
              </p>
            ) : (
              <label key={d.id} className="pf-switch">
                <input
                  type="checkbox"
                  checked={!exclude.has(d.id)}
                  onChange={(e) => {
                    const next = new Set(exclude);
                    if (e.target.checked) next.delete(d.id);
                    else next.add(d.id);
                    setExclude(next);
                  }}
                />
                Hide {KIND_LABEL[d.kind]} at {Math.round(d.box[0])}, {Math.round(d.box[1])}
              </label>
            ),
          )}
        </fieldset>
      ) : null}
      {manual.length ? (
        <ul className="pf-manual" aria-label="Areas marked by hand">
          {manual.map((b, i) => (
            <li key={`${b.join(',')}-${String(i)}`} className="small">
              Area {i + 1}: {b[2] - b[0]} × {b[3] - b[1]} px{' '}
              <button
                type="button"
                className="button button--ghost button--sm"
                onClick={() => {
                  setManual((m) => m.filter((_, n) => n !== i));
                }}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {busy ? (
        <p className="small" role="status">
          {busy}
        </p>
      ) : null}
      {progress ? (
        <div className="stack" style={{ gap: 4 }}>
          <progress className="pf-progress" max={progress.total} value={Math.min(progress.frame, progress.total)} aria-label="Video protection progress" />
          <p className="xs muted">
            Frame {progress.frame} of about {progress.total} · {progress.fps} frames per second on this device
          </p>
          <button
            type="button"
            className="button button--ghost button--sm"
            onClick={() => {
              abort.current?.abort();
            }}
          >
            Stop
          </button>
        </div>
      ) : null}
      {failure ? (
        <p className="notice small" role="alert">
          {failure}
        </p>
      ) : null}
      {file && !busy && (detected || isVideo) ? (
        <button type="button" className="button" onClick={() => void protect()}>
          {isVideo ? 'Protect video' : 'Protect picture'}
        </button>
      ) : null}
      {result ? (
        <section className="stack pf-result" aria-labelledby="pf-result">
          <h3 id="pf-result" className="pf-sub">
            Protected copy
          </h3>
          {result.file.type.startsWith('video/') ? <video src={result.url} controls playsInline aria-label="Protected video" /> : <img src={result.url} alt="Protected picture" />}
          <p className="xs muted" role="status">
            {result.summary}
          </p>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <a className="button button--ghost" href={result.url} download={result.file.name}>
              Download
            </a>
          </div>
          <label className="field">
            <span>Caption (optional)</span>
            <input
              value={caption}
              maxLength={1000}
              onChange={(e) => {
                setCaption(e.target.value);
              }}
            />
          </label>
          <button type="button" className="button" disabled={busy !== null} onClick={() => void post()}>
            Post the protected copy to Moments
          </button>
        </section>
      ) : null}
    </div>
  );
}
