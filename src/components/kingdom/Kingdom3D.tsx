'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Mounts the inherited Chatdom 3D kingdom renderer (src/chatdom/apps/web/src/kingdom/scene.ts) on a canvas.
 * The renderer is used as-is; this wrapper only supplies the options it requires. The scene is generated from
 * `seed` with a clearly labelled SIMULATED citizen source; no network or Twitch connection is made.
 */
/** Seeds the inherited generator is known to lay out cleanly (its own fixtures use these). Others can be refused. */
const VETTED_SEEDS = ['willowmere', 'lanternmere'] as const;

export function Kingdom3D({ seed: rawSeed, name }: { seed: string; name: string }) {
  const seed = VETTED_SEEDS[Math.abs(rawSeed.split('').reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) | 0, 7)) % VETTED_SEEDS.length] ?? VETTED_SEEDS[0];
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [phase, setPhase] = useState('Starting the renderer…');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const abort = new AbortController();
    let dispose: (() => void) | undefined;
    let cancelled = false;
    void import('@/chatdom/apps/web/src/kingdom/scene')
      .then(({ createKingdomScene }) =>
        createKingdomScene(canvas, {
          tier: 'town',
          seed,
          realmName: name,
          hour: 19.5,
          time: null,
          camera: 'hero',
          source: 'simulated',
          signal: abort.signal,
          onReady: () => { setReady(true); },
          onProgress: (text: string, fraction: number) => { setPhase(text); setProgress(fraction); },
          onNames: () => undefined,
          onSource: () => undefined,
          onError: (message: string) => { if (!cancelled) setError(message || 'The renderer did not give a reason.'); },
        }),
      )
      .then((instance) => {
        if (cancelled) instance.dispose();
        else dispose = () => { instance.dispose(); };
      })
      .catch((e: unknown) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); });
    return () => {
      cancelled = true;
      abort.abort();
      dispose?.();
    };
  }, [seed, name]);

  return (
    <div style={{ position: 'relative', width: '100%', aspectRatio: '16 / 9', background: '#1a1530', borderRadius: 12, overflow: 'hidden' }}>
      <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} aria-label={`3D view of ${name}`} />
      {!ready && !error ? (
        <div role="status" style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: '#f5e9c8', textAlign: 'center' }}>
          <div>
            <p>{phase}</p>
            <progress value={progress} max={1} />
          </div>
        </div>
      ) : null}
      {error ? <p role="alert" style={{ position: 'absolute', inset: 0, margin: 0, padding: 16, color: '#fecaca', background: '#1a1530' }}>3D renderer error: {error}</p> : null}
    </div>
  );
}
