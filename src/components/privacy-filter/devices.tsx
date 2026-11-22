'use client';

import { useCallback, useEffect, useState } from 'react';
import { MODEL_PATHS } from './engine/protocol';

const KEY = 'hello.privacy-filter.camera';

/** The camera chosen on this device (for example a USB camera, or OBS Studio's Virtual Camera). Stored only here. */
export function chosenCamera(): string | null {
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

/** Video constraints for the chosen camera, falling back to any camera when it is gone. */
export function cameraVideo(width: number, height: number): MediaTrackConstraints {
  const id = typeof window === 'undefined' ? null : chosenCamera();
  return id ? { width, height, deviceId: { ideal: id } } : { width, height };
}

/** Lists cameras once the page may see their names (after any camera permission was granted). */
export function useCameraChoice() {
  const [cameras, setCameras] = useState<Array<{ id: string; label: string }>>([]);
  const [chosen, setChosen] = useState<string>('');

  const refresh = useCallback(async () => {
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      setCameras(all.filter((d) => d.kind === 'videoinput').map((d, i) => ({ id: d.deviceId, label: d.label || `Camera ${String(i + 1)}` })));
    } catch {
      setCameras([]);
    }
  }, []);

  useEffect(() => {
    setChosen(chosenCamera() ?? '');
    void refresh();
    const media = typeof navigator === 'undefined' ? undefined : (navigator.mediaDevices as MediaDevices | undefined);
    const onChange = () => void refresh();
    media?.addEventListener('devicechange', onChange);
    return () => {
      media?.removeEventListener('devicechange', onChange);
    };
  }, [refresh]);

  const choose = useCallback((id: string) => {
    setChosen(id);
    try {
      if (id) window.localStorage.setItem(KEY, id);
      else window.localStorage.removeItem(KEY);
    } catch {
      /* private mode: the choice lasts for this page only */
    }
  }, []);

  return { cameras, chosen, choose, refresh };
}

export function CameraPicker() {
  const { cameras, chosen, choose, refresh } = useCameraChoice();
  return (
    <label className="field">
      <span>Camera</span>
      <select
        value={chosen}
        onFocus={() => void refresh()}
        onChange={(e) => {
          choose(e.target.value);
        }}
      >
        <option value="">Default camera</option>
        {cameras
          .filter((c) => c.id)
          .map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
      </select>
    </label>
  );
}

interface ModelRow {
  name: string;
  path: string;
  use: string;
  licence: string;
  state: 'checking' | 'installed' | 'missing';
  bytes: number | null;
}

const MODELS: Array<Omit<ModelRow, 'state' | 'bytes'>> = [
  { name: 'YuNet 2023mar', path: MODEL_PATHS.yunet, use: 'Faces', licence: 'MIT' },
  { name: 'SFace 2021dec', path: MODEL_PATHS.sface, use: 'People kept visible', licence: 'Apache-2.0' },
  { name: 'YOLOv8n-pose', path: MODEL_PATHS.pose, use: 'People seen from behind', licence: 'AGPL-3.0' },
  { name: 'YOLO11n', path: MODEL_PATHS.screens, use: 'Screens, phones and paper (zoom)', licence: 'AGPL-3.0' },
  { name: 'Tesseract English', path: '/models/privacy/eng.traineddata.gz', use: 'Phone numbers (text)', licence: 'Apache-2.0' },
  { name: 'ONNX Runtime Web', path: `${MODEL_PATHS.ortWasm}ort-wasm-simd-threaded.wasm`, use: 'Runs the models', licence: 'MIT' },
];

/** Whether each model file is installed on this HELLO server (they are downloaded by `npm run privacy:assets`). */
export function ModelStatus() {
  const [rows, setRows] = useState<ModelRow[]>(MODELS.map((m) => ({ ...m, state: 'checking', bytes: null })));
  useEffect(() => {
    let live = true;
    void Promise.all(
      MODELS.map(async (m): Promise<ModelRow> => {
        try {
          const r = await fetch(m.path, { method: 'HEAD', cache: 'no-store' });
          const size = Number(r.headers.get('content-length') ?? '');
          return { ...m, state: r.ok ? 'installed' : 'missing', bytes: r.ok && size > 0 ? size : null };
        } catch {
          return { ...m, state: 'missing', bytes: null };
        }
      }),
    ).then((next) => {
      if (live) setRows(next);
    });
    return () => {
      live = false;
    };
  }, []);
  return (
    <table className="pf-models">
      <caption className="visually-hidden">Privacy filter models</caption>
      <thead>
        <tr>
          <th scope="col">Model</th>
          <th scope="col">Used for</th>
          <th scope="col">Status</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.path}>
            <td>
              {r.name} <span className="xs muted">({r.licence})</span>
            </td>
            <td className="small">{r.use}</td>
            <td className={`small pf-models__${r.state}`}>{r.state === 'installed' ? `Installed${r.bytes ? ` · ${(r.bytes / 1048576).toFixed(1)} MB` : ''}` : r.state === 'missing' ? 'Missing' : 'Checking…'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
