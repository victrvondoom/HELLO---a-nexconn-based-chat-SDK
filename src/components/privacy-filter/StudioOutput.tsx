'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { anyDetector } from '@/domain/privacy-filter/settings';
import { PrivacyEngine, type EngineStats } from './engine/engine';
import { cameraVideo } from './devices';
import { FilterStats } from './FilterStats';
import { usePrivacyFilter } from './usePrivacyFilter';

/**
 * The protected camera, filling the window, for OBS Studio's Window Capture (or any recorder). This is HELLO's
 * stand-in for Offleak's native OBS filter: the same in-browser engine, so it needs no plugin and no second program.
 * Press H to hide or show the controls.
 */
export function StudioOutput({ eventId, userId }: { eventId: string; userId: string }) {
  const pf = usePrivacyFilter(eventId, userId);
  const video = useRef<HTMLVideoElement>(null);
  const engine = useRef<PrivacyEngine | null>(null);
  const camera = useRef<MediaStream | null>(null);
  const [stats, setStats] = useState<EngineStats | null>(null);
  const [running, setRunning] = useState(false);
  const [controls, setControls] = useState(true);
  const [error, setError] = useState<string | null>(null);

  function stop() {
    engine.current?.stop();
    engine.current = null;
    camera.current?.getTracks().forEach((t) => {
      t.stop();
    });
    camera.current = null;
    setRunning(false);
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'h' || e.key === 'H') setControls((c) => !c);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      engine.current?.stop();
      camera.current?.getTracks().forEach((t) => {
        t.stop();
      });
    };
  }, []);

  async function start() {
    setError(null);
    try {
      camera.current = await navigator.mediaDevices.getUserMedia({ video: cameraVideo(1280, 720), audio: false });
      engine.current = await PrivacyEngine.start(camera.current, { settings: pf.settings, gallery: pf.gallery, onStats: setStats, maxSide: 1280 });
      if (video.current) video.current.srcObject = engine.current.output;
      setRunning(true);
    } catch (e: unknown) {
      stop();
      setError(e instanceof DOMException && e.name === 'NotAllowedError' ? 'Camera permission was not given.' : e instanceof Error ? e.message : 'Could not start the camera.');
    }
  }

  return (
    <div className="pf-studio">
      <video ref={video} autoPlay playsInline muted aria-label="Protected camera output" />
      {controls ? (
        <div className="pf-studio__bar">
          {running ? (
            <button type="button" className="button button--ghost button--sm" onClick={stop}>
              Stop
            </button>
          ) : (
            <button type="button" className="button button--sm" disabled={!pf.loaded || !anyDetector(pf.settings)} onClick={() => void start()}>
              Start protected camera
            </button>
          )}
          <span className="xs">Press H to hide these controls before capturing the window.</span>
          <Link className="xs" href={`/events/${eventId}/privacy-filter`}>
            Settings
          </Link>
          {error ? (
            <span className="xs" role="alert">
              {error}
            </span>
          ) : null}
          {stats ? <FilterStats stats={stats} compact /> : null}
        </div>
      ) : null}
    </div>
  );
}
