'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { api, errorText } from '@/components/live/client';
import { useFeedback } from '@/components/ui/Feedback';
import { Icon } from '@/components/ui/Icon';
import { DELAY_MAX, DELAY_MIN, FPS_MAX, FPS_MIN, REDACTION_EFFECTS, anyDetector, type PrivacyFilterSettings, type RedactionEffect } from '@/domain/privacy-filter/settings';
import { CameraPicker, ModelStatus, cameraVideo } from './devices';
import { MediaTool } from './MediaTool';
import type { Box } from '@/domain/privacy-filter/geometry';
import { addPeople, removeEveryone, removePerson, MAX_PEOPLE } from './engine/gallery';
import { PrivacyEngine, type EngineStats } from './engine/engine';
import { VisionClient } from './engine/vision-client';
import { usePrivacyFilter } from './usePrivacyFilter';
import { FilterStats } from './FilterStats';

function thumbnail(image: ImageBitmap, box: Box): string {
  const [x1, y1, x2, y2] = box;
  const w = Math.max(1, x2 - x1);
  const h = Math.max(1, y2 - y1);
  const scale = Math.min(1, 160 / Math.max(w, h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  canvas.getContext('2d')?.drawImage(image, x1, y1, w, h, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.75);
}

/** Every face in a picture becomes one card; a group that cannot be split safely stays one card, marked for review. */
async function enrollFrom(image: ImageBitmap, userId: string): Promise<{ added: number; split: boolean }> {
  const vision = new VisionClient();
  try {
    const { result: init } = await vision.request({ type: 'init', faces: true, recognizer: true });
    if (!init.faces || !init.recognizer) throw new Error(init.errors[0] ?? 'The face models are not installed on this server (npm run privacy:assets).');
    const { result } = await vision.request({ type: 'enroll', image: await createImageBitmap(image) });
    if (!result.found) throw new Error('No face was found in that picture. Try a clearer, front-facing photo.');
    if (result.split) {
      await addPeople(userId, result.people.map((p) => ({ feature: p.feature, thumb: thumbnail(image, p.box), needsReview: false })));
      return { added: result.people.length, split: true };
    }
    const whole: Box = [0, 0, image.width, image.height];
    await addPeople(userId, result.people.map((p) => ({ feature: p.feature, thumb: thumbnail(image, whole), needsReview: true })));
    return { added: result.people.length, split: false };
  } finally {
    vision.terminate();
    image.close();
  }
}

const EFFECT_LABEL: Record<RedactionEffect, string> = {
  pixelate: 'Pixelate (looks like video, unreadable)',
  blur: 'Heavy blur (softer to look at)',
  blackout: 'Black box (nothing of the original survives)',
};

const stopAll = (stream: MediaStream | null) => {
  stream?.getTracks().forEach((t) => {
    t.stop();
  });
};

/**
 * The privacy filter's own page, HELLO's version of Offleak's OBS dock: people kept visible, detection switches,
 * frame rate and lookahead, a preview, Twitch, and privacy alerts.
 */
export function PrivacyDock({ eventId, userId }: { eventId: string; userId: string }) {
  const { toast } = useFeedback();
  const pf = usePrivacyFilter(eventId, userId);
  const [busy, setBusy] = useState<string | null>(null);
  const [clientId, setClientId] = useState('');
  const [stats, setStats] = useState<EngineStats | null>(null);
  const [previewing, setPreviewing] = useState<null | 'camera' | 'screen'>(null);
  const [origin, setOrigin] = useState('');
  const engine = useRef<PrivacyEngine | null>(null);
  const camera = useRef<MediaStream | null>(null);
  const video = useRef<HTMLVideoElement>(null);
  const s = pf.settings;

  useEffect(() => {
    setOrigin(window.location.origin);
    return () => {
      engine.current?.stop();
      stopAll(camera.current);
    };
  }, []);

  function stopPreview() {
    engine.current?.stop();
    engine.current = null;
    stopAll(camera.current);
    camera.current = null;
    if (video.current) video.current.srcObject = null;
    setPreviewing(null);
  }

  async function change(patch: Partial<PrivacyFilterSettings>) {
    try {
      await pf.save(patch);
      if (previewing) {
        stopPreview();
        toast('info', 'Settings saved. Start the preview again to use them.');
      }
    } catch (e: unknown) {
      toast('error', errorText(e));
    }
  }

  async function capture() {
    setBusy('capture');
    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: cameraVideo(1280, 720) });
      const v = document.createElement('video');
      v.muted = true;
      v.playsInline = true;
      v.srcObject = stream;
      await v.play();
      await new Promise((r) => setTimeout(r, 600));
      const { added, split } = await enrollFrom(await createImageBitmap(v), userId);
      toast('success', split ? `Added ${added} ${added === 1 ? 'person' : 'people'} from your camera.` : 'Added, but the faces could not be separated: check the card.');
      await pf.reloadPeople();
    } catch (e: unknown) {
      toast('error', e instanceof Error ? e.message : 'Could not use the camera.');
    } finally {
      stopAll(stream);
      setBusy(null);
    }
  }

  async function upload(file: File | undefined) {
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) {
      toast('error', 'Choose a picture under 8 MB.');
      return;
    }
    setBusy('upload');
    try {
      const { added, split } = await enrollFrom(await createImageBitmap(file), userId);
      toast('success', split ? `Added ${added} ${added === 1 ? 'person' : 'people'}.` : 'Added, but the faces could not be separated: check the card.');
      await pf.reloadPeople();
    } catch (e: unknown) {
      toast('error', e instanceof Error ? e.message : 'Could not read that picture.');
    } finally {
      setBusy(null);
    }
  }

  async function startPreview(kind: 'camera' | 'screen') {
    setBusy('preview');
    try {
      camera.current = kind === 'camera' ? await navigator.mediaDevices.getUserMedia({ video: cameraVideo(640, 360) }) : await navigator.mediaDevices.getDisplayMedia({ video: true });
      const ended = camera.current.getVideoTracks()[0];
      if (ended) ended.onended = stopPreview;
      engine.current = await PrivacyEngine.start(camera.current, { settings: s, gallery: pf.gallery, onStats: setStats, maxSide: kind === 'screen' ? 1280 : 640 });
      if (video.current) video.current.srcObject = engine.current.output;
      setPreviewing(kind);
    } catch (e: unknown) {
      stopPreview();
      const denied = e instanceof DOMException && e.name === 'NotAllowedError';
      toast('error', denied ? `Permission to use your ${kind === 'camera' ? 'camera' : 'screen'} was not given, so nothing was captured.` : e instanceof Error ? e.message : 'Could not start the preview.');
    } finally {
      setBusy(null);
    }
  }

  async function twitch(action: 'start' | 'disconnect') {
    setBusy('twitch');
    try {
      if (action === 'start') {
        const { url } = await api<{ url: string }>(`/api/events/${eventId}/privacy-filter/twitch`, 'POST', { action, clientId: clientId.trim() });
        window.location.assign(url);
        return;
      }
      await api(`/api/events/${eventId}/privacy-filter/twitch`, 'POST', { action });
      await pf.reload();
    } catch (e: unknown) {
      toast('error', errorText(e));
    } finally {
      setBusy(null);
    }
  }

  async function ack(alertId: string) {
    try {
      await api(`/api/events/${eventId}/privacy-filter`, 'POST', { action: 'ack', alertId });
      await pf.reload();
    } catch (e: unknown) {
      toast('error', errorText(e));
    }
  }

  async function remove(id: string) {
    await removePerson(userId, id);
    await pf.reloadPeople();
    toast('success', 'Removed from this device.');
  }

  async function removeAll() {
    const n = await removeEveryone(userId);
    await pf.reloadPeople();
    toast('success', `Removed ${n} from this device.`);
  }

  const twitchState = pf.state?.twitch;
  const openAlerts = (pf.state?.alerts ?? []).filter((a) => !a.acknowledged);

  return (
    <div className="pf-dock">
      <div className="stack" style={{ gap: 20 }}>
        {openAlerts.length ? (
          <div className="notice pf-alert" role="alert">
            <strong>Privacy alert</strong>
            {openAlerts.map((a) => (
              <div key={a.id} className="pf-alert__row">
                <span>
                  {a.from} {a.source === 'TWITCH' ? 'typed !privacy in your Twitch chat' : 'asked you to check your camera in a call'} · {new Date(a.at).toLocaleTimeString()}
                </span>
                <button type="button" className="button button--sm" onClick={() => void ack(a.id)}>
                  I have checked
                </button>
              </div>
            ))}
          </div>
        ) : null}

        <section className="card card__body stack" aria-labelledby="pf-preview">
          <div>
            <h2 id="pf-preview">Preview</h2>
            <p className="small muted">
              What others would see from your camera or a shared screen. Each frame is checked on this device before it is shown: strangers&rsquo; faces and heads (also from behind), QR codes and phone numbers are hidden, and whenever the filter is unsure the whole picture is.
            </p>
          </div>
          <div className="pf-stage">
            <video ref={video} autoPlay playsInline muted aria-label="Protected camera preview" />
            {!previewing ? <span className="pf-stage__idle">Preview is off</span> : null}
          </div>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            {previewing ? (
              <button type="button" className="button button--ghost" onClick={stopPreview}>
                Stop preview
              </button>
            ) : (
              <>
                <button type="button" className="button" disabled={busy !== null || !pf.loaded || !anyDetector(s)} onClick={() => void startPreview('camera')}>
                  <Icon name="camera" /> {busy === 'preview' ? 'Starting…' : 'Start preview'}
                </button>
                <button type="button" className="button button--ghost" disabled={busy !== null || !pf.loaded || !anyDetector(s)} onClick={() => void startPreview('screen')}>
                  Preview a shared screen
                </button>
              </>
            )}
          </div>
          <CameraPicker />
          {previewing && stats ? <FilterStats stats={stats} /> : null}
        </section>

        <section className="card card__body stack" aria-labelledby="pf-media">
          <div>
            <h2 id="pf-media">Protect a picture or video</h2>
            <p className="small muted">Checked on this device with your settings and the people you keep visible. Review what was found, hide more by hand, then download the protected copy or post it.</p>
          </div>
          {pf.loaded ? <MediaTool eventId={eventId} settings={s} gallery={pf.gallery} /> : null}
        </section>

        <section className="card card__body stack" aria-labelledby="pf-people">
          <div>
            <h2 id="pf-people">People kept visible</h2>
            <p className="small muted">
              Everyone else is blurred. Each face you add is kept only in this browser on this device, never sent to HELLO, and used only to recognise them in your own picture. Ask before you add someone.
            </p>
          </div>
          {pf.people.length ? (
            <ul className="pf-people" aria-label="People kept visible">
              {pf.people.map((p, i) => (
                <li key={p.id} className="pf-person">
                  <img src={p.thumb} alt={`Person ${i + 1}`} />
                  <strong>{p.needsReview ? 'Photo needs review' : `Person ${i + 1}`}</strong>
                  {p.needsReview ? <span className="xs muted">The faces in this photo could not be separated. Check it.</span> : null}
                  <button type="button" className="button button--ghost button--sm" onClick={() => void remove(p.id)}>
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="empty small">Nobody yet: everyone in your picture is blurred, including you.</p>
          )}
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className="button" disabled={busy !== null || pf.people.length >= MAX_PEOPLE} onClick={() => void capture()}>
              <Icon name="camera" /> {busy === 'capture' ? 'Capturing from camera…' : 'Add people from camera'}
            </button>
            <label className="button button--ghost pf-file">
              <Icon name="user" /> {busy === 'upload' ? 'Reading photo…' : 'Choose photo'}
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp,image/bmp"
                disabled={busy !== null}
                onChange={(e) => {
                  void upload(e.target.files?.[0]);
                  e.target.value = '';
                }}
              />
            </label>
            {pf.people.length ? (
              <button type="button" className="button button--danger button--sm" onClick={() => void removeAll()}>
                Remove everyone
              </button>
            ) : null}
          </div>
        </section>
      </div>

      <div className="stack" style={{ gap: 20 }}>
        <section className="card card__body stack" aria-labelledby="pf-switches">
          <h2 id="pf-switches">Blur detection</h2>
          <label className="pf-switch">
            <input type="checkbox" checked={s.enabled} disabled={!pf.loaded} onChange={(e) => void change({ enabled: e.target.checked })} />
            Use the privacy filter in calls
          </label>
          <label className="pf-switch">
            <input type="checkbox" checked={s.faceEnabled} disabled={!pf.loaded} onChange={(e) => void change({ faceEnabled: e.target.checked })} />
            Faces
          </label>
          <label className="pf-switch pf-switch--sub">
            <input type="checkbox" checked={s.peopleEnabled} disabled={!pf.loaded || !s.faceEnabled} onChange={(e) => void change({ peopleEnabled: e.target.checked })} />
            People seen from behind or turned away
          </label>
          <label className="pf-switch">
            <input type="checkbox" checked={s.qrEnabled} disabled={!pf.loaded} onChange={(e) => void change({ qrEnabled: e.target.checked })} />
            QR codes, including ones that cannot be read
          </label>
          <label className="pf-switch">
            <input type="checkbox" checked={s.phoneEnabled} disabled={!pf.loaded} onChange={(e) => void change({ phoneEnabled: e.target.checked })} />
            Phone numbers
          </label>
          <label className="pf-switch pf-switch--sub">
            <input type="checkbox" checked={s.screensEnabled} disabled={!pf.loaded || (!s.qrEnabled && !s.phoneEnabled)} onChange={(e) => void change({ screensEnabled: e.target.checked })} />
            Zoom into screens, phones and paper to read small codes and numbers
          </label>
          {!anyDetector(s) ? <p className="notice small">Every detector is off, so nothing would be blurred.</p> : null}
          <label className="field">
            <span>How hidden areas look</span>
            <select value={s.effect} disabled={!pf.loaded} onChange={(e) => void change({ effect: e.target.value as RedactionEffect })}>
              {REDACTION_EFFECTS.map((effect) => (
                <option key={effect} value={effect}>
                  {EFFECT_LABEL[effect]}
                </option>
              ))}
            </select>
          </label>
          <h3 className="pf-sub">Video processing</h3>
          <label className="field">
            <span>Frame rate (fps)</span>
            <input type="number" min={FPS_MIN} max={FPS_MAX} step={1} defaultValue={s.fps} key={`fps-${String(s.fps)}`} onBlur={(e) => void change({ fps: Math.round(Number(e.target.value)) })} />
          </label>
          <label className="field">
            <span>Lookahead (seconds)</span>
            <input type="number" min={DELAY_MIN} max={DELAY_MAX} step={0.5} defaultValue={s.delay} key={`delay-${String(s.delay)}`} onBlur={(e) => void change({ delay: Number(e.target.value) })} />
          </label>
          <p className="xs muted">
            Each frame waits this long so it is checked before anyone sees it; your microphone is delayed by the same amount. More fps needs a faster device. Audio itself is never filtered.
          </p>
        </section>

        <section className="card card__body stack" aria-labelledby="pf-models-title">
          <h2 id="pf-models-title">Models on this server</h2>
          <p className="xs muted">The models run in your browser; HELLO only serves the files. A missing model keeps its detector&rsquo;s whole picture hidden rather than letting anything through.</p>
          <ModelStatus />
        </section>

        <section className="card card__body stack" aria-labelledby="pf-studio">
          <h2 id="pf-studio">OBS and streaming</h2>
          <p className="xs muted">
            Into HELLO: start OBS Studio&rsquo;s Virtual Camera and choose it as the camera above; calls then filter your OBS scene. Out of HELLO: open the studio output and add that window to OBS with Window Capture. HELLO is a web app, so it does not install Offleak&rsquo;s native OBS plugin.
          </p>
          <Link className="button button--ghost button--sm" href={`/events/${eventId}/privacy-filter/studio`} target="_blank" rel="noopener">
            Open studio output
          </Link>
        </section>

        <section className="card card__body stack" aria-labelledby="pf-twitch">
          <h2 id="pf-twitch">Twitch</h2>
          <p className="small">
            Status: <strong>{twitchState?.connection ?? 'disconnected'}</strong>
            {twitchState?.channel ? ` · ${twitchState.channel}` : ''}
            {twitchState?.live ? <span className="pf-live"> · Live on Twitch</span> : null}
          </p>
          {twitchState && twitchState.connection !== 'disconnected' ? (
            <button type="button" className="button button--ghost button--sm" disabled={busy !== null} onClick={() => void twitch('disconnect')}>
              Disconnect Twitch
            </button>
          ) : (
            <>
              <label className="field">
                <span>Twitch app client ID</span>
                <input
                  value={clientId}
                  autoComplete="off"
                  maxLength={100}
                  placeholder="From dev.twitch.tv/console/apps"
                  onChange={(e) => {
                    setClientId(e.target.value);
                  }}
                />
              </label>
              <button type="button" className="button button--sm" disabled={busy !== null || !clientId.trim()} onClick={() => void twitch('start')}>
                Connect Twitch
              </button>
            </>
          )}
          <p className="xs muted">
            When you or a moderator types exactly <code>!privacy</code> in your channel, an alert appears here and in your notifications. HELLO asks Twitch only for chat-reading access and keeps the access token in server memory, never on disk. Register <code>{`${origin}/twitch/callback`}</code> as the app&rsquo;s OAuth redirect URL. Protection never depends on Twitch.
          </p>
        </section>

        <section className="card card__body stack" aria-labelledby="pf-about">
          <h2 id="pf-about">How it works</h2>
          <p className="xs muted">
            Integrated from <a href="https://github.com/azharizz/offleak">Offleak</a> (AGPL-3.0; see the licence notes in HELLO&rsquo;s source). Faces: YuNet; people you keep: SFace; people from behind: YOLOv8n-pose; screens: YOLO11n; QR codes: your browser&rsquo;s barcode reader or jsQR, plus finder-square shapes for codes that cannot be read; phone numbers: Tesseract OCR. Everything runs in this browser. It is a strong safety net, not a guarantee: a face, code or very small number can be missed. Use it in <Link href={`/events/${eventId}/calls`}>Calls</Link>, when you post to Moments, and below.
          </p>
        </section>
      </div>
    </div>
  );
}
