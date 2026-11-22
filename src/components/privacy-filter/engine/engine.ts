// SPDX-License-Identifier: AGPL-3.0-only
// The live driver of Offleak (https://github.com/azharizz/offleak, commit 24e6a77, AGPL-3.0: pipeline/live.py and
// detection/objects.py Oriented/MirrorProbe/CropZoom), in the browser: camera or screen track in, protected track out.
import { GridFlow, grayFromRgba } from '@/domain/privacy-filter/flow';
import { rotatedSize, unflip, unrotBox, type Box } from '@/domain/privacy-filter/geometry';
import { Orientation, UprightProbe, mirrorEvidence } from '@/domain/privacy-filter/orientation';
import { Redactor } from '@/domain/privacy-filter/redactor';
import type { PrivacyFilterSettings } from '@/domain/privacy-filter/settings';
import { Timings } from '@/domain/privacy-filter/timings';
import { MaskRenderer } from './render';
import { HeadScanner, ObjectScanner } from './scan';

/**
 * The privacy filter for a live camera or screen track.
 *
 * - Every output frame waits `delay` seconds in a lookahead buffer; detectors run as often as the device allows on the
 *   newest frame, and optical flow carries each box onto every frame in between.
 * - Lanes (each in its own worker): heads (faces + people from behind), objects (QR codes + phone numbers), and a
 *   slower crop-zoom lane that re-reads screens, phones and paper enlarged.
 * - Fails closed: until a switched-on lane has reported within a second of a frame, that frame is hidden whole. A
 *   lane whose model cannot load, or that stops answering for 5 seconds, never reports, so the whole picture stays
 *   hidden and the status says why.
 * - The microphone is delayed by the same lookahead so speech stays in step with the picture.
 * - Nothing leaves the device: frames, faces and embeddings stay in this tab and its workers.
 */

export interface EngineStats {
  status: 'warming' | 'running' | 'error';
  errors: string[];
  frames: number;
  output_fps: number;
  latency_ms: number | null;
  head_det_per_s: number;
  object_det_per_s: number;
  zoom_per_s: number;
  dropped: number;
  failsafe_frames: number;
  late: number;
  detector_errors: number;
  rotation_deg: number;
  mirrored: boolean;
  masked_frames: number;
  qr_engine: string;
  /** Last pass: faces and people (pose) found, QR codes found only by shape, screens found. */
  faces_seen: number;
  people_seen: number;
  qr_shapes: number;
  screens_seen: number;
  heads_ms?: number;
  objects_ms?: number;
  zoom_ms?: number;
  /** Main-thread time per frame (capture, flow, drawing). */
  tick_ms?: number;
}

type EngineSettings = Pick<PrivacyFilterSettings, 'fps' | 'delay' | 'faceEnabled' | 'qrEnabled' | 'phoneEnabled'> &
  Partial<Pick<PrivacyFilterSettings, 'peopleEnabled' | 'screensEnabled' | 'effect'>>;

export interface EngineOptions {
  settings: EngineSettings;
  /** SFace embeddings of the people kept visible (from this device's gallery). */
  gallery: number[][];
  /** Longest side of the processed picture. */
  maxSide?: number;
  onStats?: (stats: EngineStats) => void;
}

interface Buffered {
  bitmap: ImageBitmap;
  at: number;
}

/** A lane that has not answered for this long is treated as stopped (fail closed, reported). */
export const LANE_TIMEOUT_MS = 5000;
/** A lane whose models have not loaded by then is reported; it stays off, so frames stay hidden. */
export const LOAD_TIMEOUT_MS = 30000;

/** `job`, or a rejection naming the lane when it takes longer than `ms`. */
function within<T>(job: Promise<T>, ms: number, what: string): Promise<T> {
  return Promise.race([
    job,
    new Promise<T>((_, reject) => {
      window.setTimeout(() => {
        reject(new Error(`The ${what} did not load within ${String(ms / 1000)} seconds (slow or interrupted network?), so the picture stays hidden.`));
      }, ms);
    }),
  ]);
}

const ctx2d = (c: OffscreenCanvas, read = false) => c.getContext('2d', { willReadFrequently: read }) as OffscreenCanvasRenderingContext2D;
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
type Lane = 'heads' | 'objects' | 'zoom';

export class PrivacyEngine {
  readonly output: MediaStream;
  readonly width: number;
  readonly height: number;
  private readonly video: HTMLVideoElement;
  private readonly frameCanvas: OffscreenCanvas;
  private readonly halfCanvas: OffscreenCanvas;
  private readonly outCanvas: HTMLCanvasElement;
  private readonly outCtx: CanvasRenderingContext2D;
  private readonly flow: GridFlow;
  private readonly redactor: Redactor<Buffered>;
  private readonly renderer: MaskRenderer;
  private readonly orientation = new Orientation();
  private readonly upright = new UprightProbe();
  private readonly timings = new Timings();
  private readonly heads: HeadScanner | null;
  private readonly objects: ObjectScanner | null;
  private readonly zoomer: ObjectScanner | null;
  private timer: number | null = null;
  private audio: AudioContext | null = null;
  private busy: Record<Lane, number> = { heads: 0, objects: 0, zoom: 0 };
  private ready: Record<Lane, boolean> = { heads: false, objects: false, zoom: false };
  private runs: Record<Lane, number> = { heads: 0, objects: 0, zoom: 0 };
  private stalled = new Set<Lane>();
  private objectCalls = 0;
  private started = 0;
  private lastTick = 0;
  private stopped = false;
  private stats: EngineStats;

  private constructor(
    private readonly source: MediaStream,
    private readonly options: EngineOptions,
    size: { width: number; height: number },
  ) {
    const { fps, delay, faceEnabled, qrEnabled, phoneEnabled } = options.settings;
    const peopleEnabled = faceEnabled && (options.settings.peopleEnabled ?? true);
    const screensEnabled = (qrEnabled || phoneEnabled) && (options.settings.screensEnabled ?? true);
    this.width = size.width;
    this.height = size.height;
    this.video = document.createElement('video');
    this.video.muted = true;
    this.video.playsInline = true;
    this.video.srcObject = new MediaStream(source.getVideoTracks());
    this.frameCanvas = new OffscreenCanvas(this.width, this.height);
    this.halfCanvas = new OffscreenCanvas(Math.floor(this.width / 2), Math.floor(this.height / 2));
    this.outCanvas = document.createElement('canvas');
    this.outCanvas.width = this.width;
    this.outCanvas.height = this.height;
    this.outCtx = this.outCanvas.getContext('2d') as CanvasRenderingContext2D;
    // black until the lookahead has filled: nothing unchecked is ever shown
    this.outCtx.fillStyle = '#000';
    this.outCtx.fillRect(0, 0, this.width, this.height);
    this.flow = new GridFlow(this.width, this.height);
    this.redactor = new Redactor<Buffered>(fps, this.width, this.height, this.flow.pts, { delay, faceEnabled, objectsEnabled: qrEnabled || phoneEnabled });
    this.renderer = new MaskRenderer(this.width, this.height, options.settings.effect ?? 'pixelate');
    this.heads = faceEnabled ? new HeadScanner(peopleEnabled) : null;
    this.objects = qrEnabled || phoneEnabled ? new ObjectScanner({ qr: qrEnabled, phone: phoneEnabled, screens: false }) : null;
    this.zoomer = screensEnabled ? new ObjectScanner({ qr: qrEnabled, phone: phoneEnabled, screens: true }) : null;
    this.output = this.outCanvas.captureStream(fps);
    this.stats = {
      status: 'warming',
      errors: [],
      frames: 0,
      output_fps: 0,
      latency_ms: null,
      head_det_per_s: 0,
      object_det_per_s: 0,
      zoom_per_s: 0,
      dropped: 0,
      failsafe_frames: 0,
      late: 0,
      detector_errors: 0,
      rotation_deg: 0,
      mirrored: false,
      masked_frames: 0,
      qr_engine: qrEnabled ? 'loading' : 'off',
      faces_seen: 0,
      people_seen: 0,
      qr_shapes: 0,
      screens_seen: 0,
    };
  }

  /** Starts protecting `source` (its video track, and its audio delayed to match). */
  static async start(source: MediaStream, options: EngineOptions): Promise<PrivacyEngine> {
    const settings = source.getVideoTracks()[0]?.getSettings() ?? {};
    const sw = settings.width ?? 640;
    const sh = settings.height ?? 360;
    const scale = Math.min(1, (options.maxSide ?? 640) / Math.max(sw, sh));
    const even = (v: number) => Math.max(2, Math.round((v * scale) / 2) * 2);
    const engine = new PrivacyEngine(source, options, { width: even(sw), height: even(sh) });
    await engine.boot();
    return engine;
  }

  private async boot(): Promise<void> {
    const { fps, delay } = this.options.settings;
    const audioTrack = this.source.getAudioTracks()[0];
    if (audioTrack) {
      this.audio = new AudioContext();
      const input = this.audio.createMediaStreamSource(new MediaStream([audioTrack]));
      const line = this.audio.createDelay(Math.max(1, delay + 0.5));
      line.delayTime.value = delay;
      const out = this.audio.createMediaStreamDestination();
      input.connect(line).connect(out);
      for (const t of out.stream.getAudioTracks()) this.output.addTrack(t);
    }
    await this.video.play().catch(() => undefined);
    this.started = performance.now();
    this.lastTick = this.started;
    this.timer = window.setInterval(() => {
      this.tick();
    }, 1000 / fps);
    void this.load();
  }

  private fail(reason: string): void {
    if (!this.stats.errors.includes(reason)) this.stats.errors = [...this.stats.errors, reason];
    this.stats.status = 'error';
  }

  private async load(): Promise<void> {
    const jobs: Array<Promise<void>> = [];
    if (this.heads) {
      jobs.push(
        within(this.heads.load(this.options.gallery), LOAD_TIMEOUT_MS, 'face and people detector').then(() => {
          if (!this.stopped) this.ready.heads = true;
        }),
      );
    }
    if (this.objects) {
      const objects = this.objects;
      jobs.push(
        within(objects.load(), LOAD_TIMEOUT_MS, 'QR and phone-number detector').then(() => {
          if (!this.stopped) this.ready.objects = true;
          this.stats.qr_engine = objects.qrEngine;
        }),
      );
    }
    if (this.zoomer) {
      jobs.push(
        within(this.zoomer.load(), LOAD_TIMEOUT_MS, 'screen zoom detector').then(() => {
          if (!this.stopped) this.ready.zoom = true;
        }),
      );
    }
    // A lane that failed stays not ready: its detector never reports, so every frame is hidden whole (fail closed).
    for (const s of await Promise.allSettled(jobs)) if (s.status === 'rejected') this.fail(message(s.reason));
  }

  private tick(): void {
    if (this.stopped) return;
    const now = performance.now();
    try {
      this.step(now);
    } finally {
      this.timings.record('tick', performance.now() - now);
    }
  }

  private step(now: number): void {
    const period = 1000 / this.options.settings.fps;
    // A device that cannot keep up drops input frames instead of letting the delay drift (upstream: > 1 s backlog).
    if (now - this.lastTick > 2 * period) this.stats.dropped += Math.floor((now - this.lastTick) / period) - 1;
    this.lastTick = now;
    this.watchdog(now);
    if (this.video.readyState >= 2) {
      ctx2d(this.frameCanvas).drawImage(this.video, 0, 0, this.width, this.height);
      const frame: Buffered = { bitmap: this.frameCanvas.transferToImageBitmap(), at: now };
      const half = ctx2d(this.halfCanvas, true);
      half.drawImage(frame.bitmap, 0, 0, this.halfCanvas.width, this.halfCanvas.height);
      const pixels = half.getImageData(0, 0, this.halfCanvas.width, this.halfCanvas.height);
      const i = this.redactor.add(frame, this.flow.step(grayFromRgba(pixels.data, pixels.width, pixels.height)));
      this.submit(i, frame.bitmap);
    }
    this.drain();
  }

  /** A lane busy for LANE_TIMEOUT_MS is reported; it keeps blocking new passes, so frames stay hidden. */
  private watchdog(now: number): void {
    for (const lane of ['heads', 'objects', 'zoom'] as const) {
      const since = this.busy[lane];
      if (since && now - since > LANE_TIMEOUT_MS && !this.stalled.has(lane)) {
        this.stalled.add(lane);
        const name = lane === 'heads' ? 'face and people' : lane === 'objects' ? 'QR and phone-number' : 'screen zoom';
        this.fail(`The ${name} detector stopped responding, so the picture stays hidden.`);
      }
    }
  }

  private run(lane: Lane, job: () => Promise<void>): void {
    this.busy[lane] = performance.now();
    void job()
      .catch(() => {
        // one failed pass must not end the stream; the one-second fail-safe hides the gap
        this.stats.detector_errors += 1;
      })
      .finally(() => {
        this.busy[lane] = 0;
      });
  }

  private submit(i: number, bitmap: ImageBitmap): void {
    if (this.ready.heads && !this.busy.heads) this.run('heads', () => this.runHeads(i, bitmap));
    if (this.ready.objects && !this.busy.objects) this.run('objects', () => this.runObjects(i, bitmap));
    if (this.ready.zoom && !this.busy.zoom) this.run('zoom', () => this.runZoom(i, bitmap));
  }

  private async runHeads(i: number, bitmap: ImageBitmap): Promise<void> {
    const heads = this.heads;
    if (!heads) return;
    const rows = await this.timings.time('heads', async () => {
      if (this.upright.due()) {
        const { scores } = await heads.probe(await createImageBitmap(bitmap));
        this.upright.observe(scores, this.orientation);
      }
      return heads.scan(bitmap, this.orientation.rot, false);
    });
    this.redactor.putHeads(i, rows);
    this.stats.faces_seen = heads.last.faces;
    this.stats.people_seen = heads.last.people;
    this.runs.heads += 1;
  }

  /** The frame turned upright and un-mirrored (upstream Oriented), and the map from its boxes back to the frame. */
  private oriented(bitmap: ImageBitmap): { canvas: OffscreenCanvas; back: (b: Box) => Box } {
    const k = this.orientation.rot;
    const mirrored = this.orientation.mirror;
    const [gw, gh] = rotatedSize(k, this.width, this.height);
    const canvas = new OffscreenCanvas(gw, gh);
    const o = ctx2d(canvas);
    // rotate k quarter turns clockwise, then mirror in the rotated picture (upstream: rot90, then flip)
    o.translate(gw / 2, gh / 2);
    if (mirrored) o.scale(-1, 1);
    o.rotate((k * Math.PI) / 2);
    o.drawImage(bitmap, -this.width / 2, -this.height / 2);
    return { canvas, back: (b: Box): Box => unrotBox(unflip(b, mirrored, false, gw, gh), k, this.width, this.height).map(Math.round) as Box };
  }

  /** QR + phone numbers on the upright, un-mirrored frame (upstream Oriented + Composite + MirrorProbe). */
  private async runObjects(i: number, bitmap: ImageBitmap): Promise<void> {
    const objects = this.objects;
    if (!objects) return;
    const { canvas, back } = this.oriented(bitmap);
    const found = await this.timings.time('objects', async () => {
      this.objectCalls += 1;
      const probe = objects.opts.phone && this.objectCalls % 5 === 0;
      const [scan, flipped] = await Promise.all([objects.scan(canvas, false), probe ? objects.readFlipped(canvas) : Promise.resolve(null)]);
      const phone = [...scan.phone];
      if (flipped) {
        this.orientation.observeMirror(mirrorEvidence({ phones: flipped.phone.length, textScore: flipped.textScore }, { phones: scan.phone.length, textScore: scan.textScore }));
        // numbers read in the flipped image are kept too (fail closed)
        phone.push(...flipped.phone.map((b) => unflip(b, true, false, canvas.width, canvas.height)));
      }
      return { qr: scan.qr, phone, shapes: scan.shapes };
    });
    this.redactor.putObjects(i, found.qr.map(back), found.phone.map(back));
    this.stats.qr_shapes = found.shapes;
    this.runs.objects += 1;
  }

  /** Crop zoom, at its own pace: extra boxes inside screens; never a substitute for the objects lane. */
  private async runZoom(i: number, bitmap: ImageBitmap): Promise<void> {
    const zoomer = this.zoomer;
    if (!zoomer) return;
    const { canvas, back } = this.oriented(bitmap);
    const found = await this.timings.time('zoom', () => zoomer.zoom(canvas, 2));
    this.redactor.addExtra(i, [...found.qr, ...found.phone].map(back));
    this.stats.screens_seen = found.screens;
    this.runs.zoom += 1;
  }

  private drain(): void {
    const r = this.redactor;
    while (r.ready()) {
      const { frame, plan } = r.emit();
      if (this.renderer.draw(this.outCtx, frame.bitmap, plan)) this.stats.masked_frames += 1;
      frame.bitmap.close();
      this.stats.latency_ms = Math.round(performance.now() - frame.at);
    }
    const wall = Math.max(1e-3, (performance.now() - this.started) / 1000);
    const rate = (n: number) => Math.round((n / wall) * 10) / 10;
    this.stats = {
      ...this.stats,
      status: r.out > 0 && this.stats.status !== 'error' ? 'running' : this.stats.status,
      frames: r.out,
      output_fps: rate(r.out),
      head_det_per_s: rate(this.runs.heads),
      object_det_per_s: rate(this.runs.objects),
      zoom_per_s: rate(this.runs.zoom),
      failsafe_frames: r.failsafe,
      late: r.late,
      rotation_deg: this.orientation.rot * 90,
      mirrored: this.orientation.mirror,
      ...this.timings.snapshot(),
    };
    this.options.onStats?.(this.stats);
  }

  get currentStats(): EngineStats {
    return this.stats;
  }

  /** The protected video track, to send in place of the camera. */
  get videoTrack(): MediaStreamTrack | null {
    return this.output.getVideoTracks()[0] ?? null;
  }

  /** The delayed microphone, when the source had one. */
  get audioTrack(): MediaStreamTrack | null {
    return this.output.getAudioTracks()[0] ?? null;
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    if (this.timer !== null) window.clearInterval(this.timer);
    this.heads?.terminate();
    void this.objects?.terminate();
    void this.zoomer?.terminate();
    while (this.redactor.ready(true)) this.redactor.emit().frame.bitmap.close();
    for (const t of this.output.getTracks()) t.stop();
    void this.audio?.close();
    this.video.srcObject = null;
  }
}
