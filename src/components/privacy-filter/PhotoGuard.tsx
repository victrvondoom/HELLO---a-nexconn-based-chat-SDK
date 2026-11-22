'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/components/live/client';
import { anyDetector, DEFAULT_PRIVACY_FILTER, type PrivacyFilterSettings } from '@/domain/privacy-filter/settings';
import type { UploadPrivacy } from '@/domain/privacy-filter/upload';
import { featuresOf, listPeople } from './engine/gallery';
import type { PhotoReport } from './engine/photo';
import type { VideoProgress, VideoReport } from './engine/video';

interface Loaded {
  settings: PrivacyFilterSettings;
  userId: string;
}

export interface PreparedUpload {
  file: File;
  /** Sent with the upload: the server refuses undeclared uploads from people whose filter is on. */
  privacy: UploadPrivacy;
}

/**
 * Picture and video protection for Moments: before a file is uploaded, this device hides strangers' faces and heads,
 * QR codes and phone numbers in it (Offleak's offline mode). The server only ever receives the protected copy.
 * The person can switch it off for one file, and the upload then says so. Animated GIFs cannot be checked, so with
 * protection on they are refused rather than sent unchecked.
 */
export function usePhotoGuard(eventId: string) {
  const [config, setConfig] = useState<Loaded | null>(null);
  const [protect, setProtect] = useState(true);
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<PhotoReport | null>(null);
  const [videoReport, setVideoReport] = useState<VideoReport | null>(null);
  const [progress, setProgress] = useState<VideoProgress | null>(null);
  const cache = useRef(new Map<File, File>());

  useEffect(() => {
    let live = true;
    api<{ settings: PrivacyFilterSettings; userId: string }>(`/api/events/${eventId}/privacy-filter`)
      .then((r) => {
        if (!live) return;
        setConfig({ settings: r.settings, userId: r.userId });
        setProtect(r.settings.enabled && anyDetector(r.settings));
      })
      .catch(() => {
        if (live) setConfig({ settings: { ...DEFAULT_PRIVACY_FILTER }, userId: '' });
      });
    return () => {
      live = false;
    };
  }, [eventId]);

  /** The file to upload, and how it was prepared. Throws instead of ever returning an unchecked file while protecting. */
  const prepare = useCallback(
    async (file: File): Promise<PreparedUpload> => {
      const filterOn = config?.settings.enabled ?? false;
      if (!protect) return { file, privacy: filterOn ? 'declined' : 'off' };
      if (file.type === 'image/gif') throw new Error('Animated GIFs cannot be checked on this device. Post it as a video, or switch protection off for this file.');
      const isVideo = file.type.startsWith('video/');
      if (!isVideo && !file.type.startsWith('image/')) throw new Error('Only pictures and videos can be protected.');
      const known = cache.current.get(file);
      if (known) return { file: known, privacy: 'protected' };
      setBusy(true);
      try {
        const settings = config?.settings ?? DEFAULT_PRIVACY_FILTER;
        const gallery = config?.userId ? featuresOf(await listPeople(config.userId).catch(() => [])) : [];
        if (isVideo) {
          const { protectVideo } = await import('./engine/video');
          setProgress({ frame: 0, total: 1, fps: 0 });
          const result = await protectVideo(file, { settings, gallery, onProgress: setProgress });
          cache.current.set(file, result.file);
          setVideoReport(result.report);
          return { file: result.file, privacy: 'protected' };
        }
        const { protectPhoto } = await import('./engine/photo');
        const result = await protectPhoto(file, settings, gallery);
        cache.current.set(file, result.file);
        setReport(result.report);
        return { file: result.file, privacy: 'protected' };
      } finally {
        setBusy(false);
        setProgress(null);
      }
    },
    [config, protect],
  );

  const reset = useCallback(() => {
    setReport(null);
    setVideoReport(null);
    cache.current.clear();
  }, []);

  return { protect, setProtect, busy, report, videoReport, progress, prepare, reset, ready: config !== null, filterOn: config?.settings.enabled ?? false };
}

export function photoSummary(report: PhotoReport): string {
  if (report.failedClosed) return 'A check could not run, so the whole picture was hidden.';
  const parts: string[] = [];
  const blurred = report.faces - report.facesKept;
  if (blurred > 0) parts.push(`${String(blurred)} ${blurred === 1 ? 'face' : 'faces'} blurred`);
  if (report.people > report.faces) parts.push(`${String(report.people)} people found (including from behind)`);
  if (report.facesKept) parts.push(`${String(report.facesKept)} kept visible`);
  if (report.qr) parts.push(`${String(report.qr)} QR ${report.qr === 1 ? 'code' : 'codes'} masked${report.qrShapes ? ` (${String(report.qrShapes)} not readable)` : ''}`);
  if (report.phone) parts.push(`${String(report.phone)} phone ${report.phone === 1 ? 'number' : 'numbers'} masked`);
  if (report.screens) parts.push(`${String(report.screens)} ${report.screens === 1 ? 'screen' : 'screens'} zoomed into`);
  if (report.manual) parts.push(`${String(report.manual)} marked by hand`);
  if (report.excluded) parts.push(`${String(report.excluded)} left visible by you`);
  return parts.length ? `${parts.join(', ')}.` : 'Nothing needed hiding.';
}

export function videoSummary(r: VideoReport): string {
  const parts = [`${String(r.frames)} frames checked (${String(r.processingFps)} per second on this device)`, `${String(r.framesWithBlur)} with something hidden`];
  if (r.failsafeFrames) parts.push(`${String(r.failsafeFrames)} hidden whole because a check was missing`);
  parts.push(`audio ${r.audio}`);
  return `${parts.join(', ')}.`;
}

/** The switch and the result line shown in a composer. */
export function PhotoGuardControl({ guard, file }: { guard: ReturnType<typeof usePhotoGuard>; file: File | null }) {
  const video = file?.type.startsWith('video/') ?? false;
  const gif = file?.type === 'image/gif';
  return (
    <div className="pf-guard">
      <label className="pf-switch">
        <input
          type="checkbox"
          checked={guard.protect}
          disabled={guard.busy}
          onChange={(e) => {
            guard.setProtect(e.target.checked);
            guard.reset();
          }}
        />
        Protect privacy: hide strangers, QR codes and phone numbers on this device before posting
      </label>
      {guard.busy && !guard.progress ? <p className="xs muted">Checking on this device…</p> : null}
      {guard.progress ? (
        <div className="stack" style={{ gap: 4 }}>
          <progress className="pf-progress" max={guard.progress.total} value={Math.min(guard.progress.frame, guard.progress.total)} aria-label="Video protection progress" />
          <p className="xs muted" role="status">
            Checking the video on this device: frame {guard.progress.frame} of about {guard.progress.total} ({guard.progress.fps} per second).
          </p>
        </div>
      ) : null}
      {guard.report && !guard.busy ? (
        <p className="xs muted" role="status">
          {photoSummary(guard.report)}
        </p>
      ) : null}
      {guard.videoReport && !guard.busy ? (
        <p className="xs muted" role="status">
          {videoSummary(guard.videoReport)}
        </p>
      ) : null}
      {video && guard.protect && !guard.busy && !guard.videoReport ? <p className="xs muted">The video is checked frame by frame when you post. Its sound is kept as it is.</p> : null}
      {gif && guard.protect ? <p className="xs notice">Animated GIFs cannot be checked. Post it as a video, or switch protection off for this file.</p> : null}
      {!guard.protect && guard.filterOn ? <p className="xs muted">Protection is off for this file only. It will be posted exactly as it is.</p> : null}
    </div>
  );
}
