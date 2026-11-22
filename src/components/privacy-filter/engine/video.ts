// SPDX-License-Identifier: AGPL-3.0-only
// Offleak's file redaction (https://github.com/azharizz/offleak, commit 24e6a77, AGPL-3.0: pipeline/offline.py
// run_sync / redact_video and cli/redact.py defaults) in the browser: decode, detect, track, redact, encode.
import { ArrayBufferTarget, Muxer } from 'webm-muxer';
import { GridFlow, grayFromRgba } from '@/domain/privacy-filter/flow';
import type { Box } from '@/domain/privacy-filter/geometry';
import { Redactor } from '@/domain/privacy-filter/redactor';
import type { RedactionEffect } from '@/domain/privacy-filter/settings';
import type { PhotoSettings } from './photo';
import { MaskRenderer } from './render';
import { HeadScanner, ObjectScanner } from './scan';

/**
 * Protects a video file on this device and returns a new WebM (VP9 or VP8 video, Opus audio).
 *
 * Every frame the browser decodes is processed (up to 30 per second of video): the face and people lane runs on
 * every frame and the QR / phone-number lane on every second one (upstream's `--head-every 1 --stride 2`), crop
 * zoom every sixth. Optical flow carries each box between frames and the Redactor's lookahead (1.5 s) lets a
 * detection hide the frames before it too. A frame whose lanes did not report within a second is hidden whole.
 * Audio is carried over unredacted, as upstream does: speech is never filtered.
 *
 * Needs WebCodecs (VideoEncoder) and requestVideoFrameCallback: current Chrome, Edge, Firefox and Safari.
 */

export interface VideoReport {
  frames: number;
  fps: number;
  width: number;
  height: number;
  duration: number;
  /** Frames where anything was hidden, and of those, frames hidden whole (a lane did not report). */
  framesWithBlur: number;
  failsafeFrames: number;
  /** Detections summed over every pass. */
  faces: number;
  people: number;
  qr: number;
  phone: number;
  manual: number;
  seconds: number;
  processingFps: number;
  audio: 'carried over (not redacted)' | 'none';
  codec: string;
  bytes: number;
}

export interface VideoProgress {
  frame: number;
  /** Expected frames (from the duration); the last frames may differ slightly. */
  total: number;
  fps: number;
}

export interface VideoOptions {
  settings: PhotoSettings;
  gallery: number[][];
  /** Areas hidden on every frame, in the source video's pixels. */
  manual?: readonly Box[];
  effect?: RedactionEffect;
  /** Longest side of the output. */
  maxSide?: number;
  /** Upper bound for the output file (Moments allows 24 MB). */
  maxBytes?: number;
  onProgress?: (p: VideoProgress) => void;
  signal?: AbortSignal;
}

export const VIDEO_MAX_SECONDS = 180;
const MAX_FPS = 30;
/** pipeline/offline.py defaults (cli/redact.py). */
const OFFLINE = { delay: 1.5, hold: 0.5, faceHold: 0.15, keep: 1.5, headEvery: 1, objectEvery: 2, zoomEvery: 6 } as const;

interface Frame {
  bitmap: ImageBitmap;
  /** Microseconds from the start of the video. */
  ts: number;
}

export class VideoUnsupportedError extends Error {}

/** True when this browser has what video protection needs. */
export function videoProtectionSupported(): boolean {
  return typeof window !== 'undefined' && 'VideoEncoder' in window && 'VideoFrame' in window && typeof HTMLVideoElement !== 'undefined' && 'requestVideoFrameCallback' in HTMLVideoElement.prototype;
}

async function pickCodec(width: number, height: number, bitrate: number, framerate: number): Promise<{ codec: string; mux: 'V_VP9' | 'V_VP8' }> {
  for (const [codec, mux] of [['vp09.00.10.08', 'V_VP9'], ['vp8', 'V_VP8']] as const) {
    const { supported } = await VideoEncoder.isConfigSupported({ codec, width, height, bitrate, framerate });
    if (supported) return { codec, mux };
  }
  throw new VideoUnsupportedError('This browser cannot encode WebM video (VP9 or VP8).');
}

async function readAudio(file: Blob): Promise<AudioBuffer | null> {
  try {
    const ctx = new OfflineAudioContext(1, 1, 48000);
    const decoded = await ctx.decodeAudioData(await file.arrayBuffer());
    if (!decoded.length) return null;
    // resample to 48 kHz (Opus) with at most two channels
    const channels = Math.min(2, decoded.numberOfChannels);
    const offline = new OfflineAudioContext(channels, Math.ceil(decoded.duration * 48000), 48000);
    const src = offline.createBufferSource();
    src.buffer = decoded;
    src.connect(offline.destination);
    src.start();
    return await offline.startRendering();
  } catch {
    return null;
  }
}

/** Opens the file in a video element; rejects with a readable reason when the browser cannot play it. */
async function open(file: Blob): Promise<HTMLVideoElement> {
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.src = URL.createObjectURL(file);
  await new Promise<void>((resolve, reject) => {
    video.onloadedmetadata = () => {
      resolve();
    };
    video.onerror = () => {
      reject(new VideoUnsupportedError('This browser cannot play that video file, so it could not be checked.'));
    };
  });
  if (video.duration === Infinity) {
    // Browser recordings (MediaRecorder WebM) often carry no duration: seeking far past the end makes the browser
    // read the whole file and report it.
    await new Promise<void>((resolve) => {
      const done = () => {
        if (Number.isFinite(video.duration)) {
          video.removeEventListener('durationchange', done);
          resolve();
        }
      };
      video.addEventListener('durationchange', done);
      video.currentTime = 1e101;
      window.setTimeout(resolve, 10000);
    });
    video.currentTime = 0;
    await new Promise<void>((resolve) => {
      video.onseeked = () => {
        resolve();
      };
      window.setTimeout(resolve, 3000);
    });
  }
  if (!video.videoWidth || !video.videoHeight || !Number.isFinite(video.duration)) throw new VideoUnsupportedError('That video has no readable picture or length.');
  return video;
}

/**
 * Plays the video and hands over each decoded frame: the element is paused inside every frame callback and resumed
 * after the frame was handled, so processing time never skips frames.
 */
function eachFrame(video: HTMLVideoElement, handle: (bitmap: ImageBitmap, mediaTime: number) => Promise<void>, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let done = false;
    let busy = false;
    let watchdog = 0;
    const finish = (error?: unknown) => {
      if (done) return;
      done = true;
      window.clearTimeout(watchdog);
      video.pause();
      if (error) reject(error instanceof Error ? error : new Error('The video could not be decoded.'));
      else resolve();
    };
    const arm = () => {
      window.clearTimeout(watchdog);
      // no new frame for 10 s while playing: the decoder stalled
      watchdog = window.setTimeout(() => {
        if (video.ended || video.currentTime >= video.duration - 0.05) finish();
        else finish(new Error('The video stopped decoding part-way through.'));
      }, 10000);
    };
    const onFrame = (_now: number, meta: VideoFrameCallbackMetadata) => {
      video.pause();
      window.clearTimeout(watchdog);
      if (signal?.aborted) {
        finish(new DOMException('Stopped', 'AbortError'));
        return;
      }
      busy = true;
      createImageBitmap(video)
        .then((bitmap) => handle(bitmap, meta.mediaTime))
        .then(() => {
          busy = false;
          if (done) return;
          if (video.ended || video.currentTime >= video.duration) {
            finish();
            return;
          }
          video.requestVideoFrameCallback(onFrame);
          arm();
          void video.play().catch(finish);
        })
        .catch(finish);
    };
    video.onended = () => {
      // the last frame's callback may still be running: it finishes after it
      if (!busy) finish();
    };
    video.requestVideoFrameCallback(onFrame);
    arm();
    void video.play().catch(finish);
  });
}

export async function protectVideo(file: File, options: VideoOptions): Promise<{ file: File; report: VideoReport }> {
  if (!videoProtectionSupported()) throw new VideoUnsupportedError('This browser cannot process video on the device (it needs WebCodecs). Try a current Chrome, Edge, Firefox or Safari.');
  const { settings } = options;
  const started = performance.now();
  const video = await open(file);
  try {
    const duration = video.duration;
    if (duration > VIDEO_MAX_SECONDS) throw new VideoUnsupportedError(`Videos up to ${String(VIDEO_MAX_SECONDS / 60)} minutes can be protected on this device.`);
    const scale = Math.min(1, (options.maxSide ?? 960) / Math.max(video.videoWidth, video.videoHeight));
    const even = (v: number) => Math.max(2, Math.round((v * scale) / 2) * 2);
    const w = even(video.videoWidth);
    const h = even(video.videoHeight);

    const heads = settings.faceEnabled ? new HeadScanner(settings.peopleEnabled ?? true) : null;
    const objects = settings.qrEnabled || settings.phoneEnabled ? new ObjectScanner({ qr: settings.qrEnabled, phone: settings.phoneEnabled, screens: settings.screensEnabled ?? true }) : null;
    try {
      // A lane that cannot load stops the job: a video is never produced half-checked.
      await Promise.all([heads?.load(options.gallery), objects?.load()]);
      const audio = await readAudio(file);
      const maxBytes = options.maxBytes ?? 22 * 1024 * 1024;
      const audioBitrate = audio ? 96_000 : 0;
      const bitrate = Math.max(300_000, Math.min(2_500_000, Math.floor((maxBytes * 8 * 0.9) / Math.max(1, duration)) - audioBitrate));
      const { codec, mux } = await pickCodec(w, h, bitrate, MAX_FPS);
      const muxer = new Muxer({
        target: new ArrayBufferTarget(),
        video: { codec: mux, width: w, height: h, frameRate: MAX_FPS },
        ...(audio ? { audio: { codec: 'A_OPUS', sampleRate: 48000, numberOfChannels: audio.numberOfChannels } } : {}),
        firstTimestampBehavior: 'offset',
      });
      let encodeError: unknown = null;
      const encoder = new VideoEncoder({
        output: (chunk, meta) => {
          muxer.addVideoChunk(chunk, meta);
        },
        error: (e) => {
          encodeError = e;
        },
      });
      encoder.configure({ codec, width: w, height: h, bitrate, framerate: MAX_FPS });

      const frameCanvas = new OffscreenCanvas(w, h);
      const frameCtx = frameCanvas.getContext('2d') as OffscreenCanvasRenderingContext2D;
      const half = new OffscreenCanvas(Math.floor(w / 2), Math.floor(h / 2));
      const halfCtx = half.getContext('2d', { willReadFrequently: true }) as OffscreenCanvasRenderingContext2D;
      const out = new OffscreenCanvas(w, h);
      const outCtx = out.getContext('2d') as OffscreenCanvasRenderingContext2D;
      const flow = new GridFlow(w, h);
      const renderer = new MaskRenderer(w, h, options.effect ?? settings.effect ?? 'pixelate');
      // manual regions arrive in the source video's pixels
      const manual = (options.manual ?? []).map((b) => b.map((v) => Math.round(v * scale)) as Box);
      const report: VideoReport = { frames: 0, fps: 0, width: w, height: h, duration, framesWithBlur: 0, failsafeFrames: 0, faces: 0, people: 0, qr: 0, phone: 0, manual: manual.length, seconds: 0, processingFps: 0, audio: audio ? 'carried over (not redacted)' : 'none', codec, bytes: 0 };
      let redactor: Redactor<Frame> | null = null;
      let first: { bitmap: ImageBitmap; t: number } | null = null;
      let lastTime = -1;
      let index = 0;
      const total = Math.max(1, Math.round(duration * MAX_FPS));
      const failure = () => (encodeError instanceof Error ? encodeError : new Error('The video encoder failed.'));

      const emitReady = (flush: boolean) => {
        if (!redactor) return;
        while (redactor.ready(flush)) {
          const { frame, plan } = redactor.emit();
          if (renderer.draw(outCtx, frame.bitmap, Redactor.withManual(plan, manual))) report.framesWithBlur += 1;
          frame.bitmap.close();
          const vf = new VideoFrame(out, { timestamp: frame.ts });
          encoder.encode(vf, { keyFrame: report.frames % (2 * MAX_FPS) === 0 });
          vf.close();
          report.frames += 1;
        }
        report.failsafeFrames = redactor.failsafe;
      };

      const step = async (r: Redactor<Frame>, bitmap: ImageBitmap, t: number) => {
        halfCtx.drawImage(bitmap, 0, 0, half.width, half.height);
        const px = halfCtx.getImageData(0, 0, half.width, half.height);
        const i = r.add({ bitmap, ts: Math.round(t * 1e6) }, flow.step(grayFromRgba(px.data, px.width, px.height)));
        try {
          if (heads && i % OFFLINE.headEvery === 0) {
            r.putHeads(i, await heads.scan(bitmap, 0, false));
            report.faces += heads.last.faces;
            report.people += heads.last.people;
          }
          if (objects && i % OFFLINE.objectEvery === 0) {
            const c = new OffscreenCanvas(w, h);
            (c.getContext('2d') as OffscreenCanvasRenderingContext2D).drawImage(bitmap, 0, 0);
            const found = await objects.scan(c, false);
            r.putObjects(i, found.qr, found.phone);
            report.qr += found.qr.length;
            report.phone += found.phone.length;
            if (i % OFFLINE.zoomEvery === 0) {
              const zoom = await objects.zoom(c, 3);
              r.addExtra(i, [...zoom.qr, ...zoom.phone]);
              report.qr += zoom.qr.length;
              report.phone += zoom.phone.length;
            }
          }
        } catch {
          // a failed pass leaves no result for this frame: the fail-safe hides the frames around it
        }
        index += 1;
        emitReady(false);
        if (encodeError) throw failure();
        const seconds = (performance.now() - started) / 1000;
        options.onProgress?.({ frame: index, total, fps: Math.round((index / Math.max(seconds, 1e-3)) * 10) / 10 });
      };

      const redactorFor = (fps: number, delay: number) =>
        new Redactor<Frame>(fps, w, h, flow.pts, { delay, hold: OFFLINE.hold, faceHold: OFFLINE.faceHold, keep: OFFLINE.keep, faceEnabled: settings.faceEnabled, objectsEnabled: objects !== null });

      await eachFrame(
        video,
        async (source, t) => {
          // keep at most 30 frames per second of video
          if (lastTime >= 0 && t - lastTime < 1 / MAX_FPS - 1e-3) {
            source.close();
            return;
          }
          lastTime = t;
          frameCtx.drawImage(source, 0, 0, w, h);
          source.close();
          const bitmap = frameCanvas.transferToImageBitmap();
          if (redactor) {
            await step(redactor, bitmap, t);
            return;
          }
          if (!first) {
            first = { bitmap, t };
            return;
          }
          // the frame rate is measured from the first two frames, then capped at 30
          report.fps = Math.min(MAX_FPS, Math.max(10, Math.round(1 / Math.max(1e-3, t - first.t))));
          const r = redactorFor(report.fps, OFFLINE.delay);
          redactor = r;
          const held = first;
          first = null;
          await step(r, held.bitmap, held.t);
          await step(r, bitmap, t);
        },
        options.signal,
      );
      // (assigned inside the frame callback, which TypeScript's flow analysis cannot see)
      const pending = first as { bitmap: ImageBitmap; t: number } | null;
      if (!(redactor as Redactor<Frame> | null) && pending) {
        // a one-frame video
        const held = pending;
        report.fps = MAX_FPS;
        const r = redactorFor(MAX_FPS, 0);
        redactor = r;
        await step(r, held.bitmap, held.t);
      }
      emitReady(true);
      if (!report.frames) throw new VideoUnsupportedError('No frames could be read from that video.');
      await encoder.flush();
      encoder.close();
      if (audio) {
        const audioEncoder = new AudioEncoder({
          output: (chunk, meta) => {
            muxer.addAudioChunk(chunk, meta);
          },
          error: (e) => {
            encodeError = e;
          },
        });
        audioEncoder.configure({ codec: 'opus', sampleRate: 48000, numberOfChannels: audio.numberOfChannels, bitrate: audioBitrate });
        const block = 48000; // one second
        for (let start = 0; start < audio.length; start += block) {
          const n = Math.min(block, audio.length - start);
          const planar = new Float32Array(n * audio.numberOfChannels);
          for (let c = 0; c < audio.numberOfChannels; c += 1) planar.set(audio.getChannelData(c).subarray(start, start + n), c * n);
          const data = new AudioData({ format: 'f32-planar', sampleRate: 48000, numberOfFrames: n, numberOfChannels: audio.numberOfChannels, timestamp: Math.round((start / 48000) * 1e6), data: planar });
          audioEncoder.encode(data);
          data.close();
        }
        await audioEncoder.flush();
        audioEncoder.close();
      }
      if (encodeError) throw failure();
      muxer.finalize();
      const bytes = muxer.target.buffer;
      report.bytes = bytes.byteLength;
      report.seconds = Math.round((performance.now() - started) / 100) / 10;
      report.processingFps = Math.round((report.frames / Math.max(1e-3, report.seconds)) * 10) / 10;
      const name = file.name.replace(/\.[^.]+$/, '') || 'video';
      return { file: new File([bytes], `${name}-protected.webm`, { type: 'video/webm' }), report };
    } finally {
      heads?.terminate();
      await objects?.terminate();
    }
  } finally {
    URL.revokeObjectURL(video.src);
    video.removeAttribute('src');
    video.load();
  }
}
