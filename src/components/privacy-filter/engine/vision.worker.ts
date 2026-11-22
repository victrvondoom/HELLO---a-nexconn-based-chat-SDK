/// <reference lib="webworker" />
// SPDX-License-Identifier: AGPL-3.0-only
// The face, identity, pose, screen and QR lanes of Offleak (https://github.com/azharizz/offleak, commit 24e6a77,
// AGPL-3.0: detection/faces.py, detection/heads.py, detection/objects.py CropZoom, detection/orientation.py
// UprightProbe, dock/references.py split_group), run in a browser worker with ONNX Runtime Web instead of OpenCV
// and PyTorch. The finder-pattern QR locator (finder.ts) is HELLO's own, in place of QRDet.
import * as ort from 'onnxruntime-web/wasm';
import jsQR from 'jsqr';
import { at, iou, rotatedSize, unrotFace, xyxy, type Box, type FaceRow } from '@/domain/privacy-filter/geometry';
import { bgrTensor, detectFaces, letterbox, nms, YUNET_SIZE, type YunetOutputs } from '@/domain/privacy-filter/yunet';
import { SFACE_SIZE, alignTransform, rgbTensor } from '@/domain/privacy-filter/align';
import { cosine, galleryScore } from '@/domain/privacy-filter/identity';
import { headBox, shouldScore, type ScoredFace } from '@/domain/privacy-filter/heads';
import { decodeDetections, decodePose, rgbTensor01, suppress, yoloFit, YOLO_PAD, YOLO_SIZE, type PosePerson } from '@/domain/privacy-filter/yolo';
import { findQrShapes } from '@/domain/privacy-filter/finder';
import { SCREEN_CLASSES, SCREEN_CONF } from '@/domain/privacy-filter/zoom';
import { unrotBox } from '@/domain/privacy-filter/geometry';
import { MODEL_PATHS, type Envelope, type EnrollResult, type InitResult, type PoseFound, type VisionRequest, type VisionResult } from './protocol';

declare const self: DedicatedWorkerGlobalScope;

ort.env.wasm.wasmPaths = MODEL_PATHS.ortWasm;
ort.env.wasm.numThreads = 1;

interface BarcodeLike {
  detect(source: ImageBitmapSource): Promise<Array<{ boundingBox: DOMRectReadOnly }>>;
}
interface BarcodeCtor {
  new (options: { formats: string[] }): BarcodeLike;
  getSupportedFormats(): Promise<string[]>;
}

let detector: ort.InferenceSession | null = null;
let recognizer: ort.InferenceSession | null = null;
let pose: ort.InferenceSession | null = null;
let screens: ort.InferenceSession | null = null;
let gallery: Float32Array[] = [];
let barcode: BarcodeLike | null = null;

const input = new OffscreenCanvas(YUNET_SIZE, YUNET_SIZE);
const inputCtx = input.getContext('2d', { willReadFrequently: true }) as OffscreenCanvasRenderingContext2D;
const crop = new OffscreenCanvas(SFACE_SIZE, SFACE_SIZE);
const cropCtx = crop.getContext('2d', { willReadFrequently: true }) as OffscreenCanvasRenderingContext2D;

type Source = ImageBitmap | OffscreenCanvas;
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

async function init(req: { faces: boolean; recognizer: boolean; pose?: boolean; screens?: boolean }): Promise<InitResult> {
  const errors: string[] = [];
  if (req.faces && !detector) {
    try {
      detector = await ort.InferenceSession.create(MODEL_PATHS.yunet, { executionProviders: ['wasm'] });
    } catch (e) {
      errors.push(`Face detector (YuNet) could not load: ${message(e)}`);
    }
  }
  if (req.recognizer && !recognizer) {
    try {
      recognizer = await ort.InferenceSession.create(MODEL_PATHS.sface, { executionProviders: ['wasm'] });
    } catch (e) {
      errors.push(`Face recogniser (SFace) could not load: ${message(e)}`);
    }
  }
  if (req.pose && !pose) {
    try {
      pose = await ort.InferenceSession.create(MODEL_PATHS.pose, { executionProviders: ['wasm'] });
    } catch (e) {
      errors.push(`People detector (YOLOv8n-pose) could not load: ${message(e)}`);
    }
  }
  if (req.screens && !screens) {
    try {
      screens = await ort.InferenceSession.create(MODEL_PATHS.screens, { executionProviders: ['wasm'] });
    } catch (e) {
      errors.push(`Screen detector (YOLO11n) could not load: ${message(e)}`);
    }
  }
  const Detector = (self as unknown as { BarcodeDetector?: BarcodeCtor }).BarcodeDetector;
  if (!barcode && Detector) {
    try {
      if ((await Detector.getSupportedFormats()).includes('qr_code')) barcode = new Detector({ formats: ['qr_code'] });
    } catch {
      barcode = null;
    }
  }
  return { faces: detector !== null, recognizer: recognizer !== null, pose: pose !== null, screens: screens !== null, qr: barcode ? 'BarcodeDetector' : 'jsQR', errors };
}

/** YuNet on one image region (sx, sy, sw, sh) of `source`; rows in source pixels. */
async function detectRegion(source: Source, sx: number, sy: number, sw: number, sh: number): Promise<FaceRow[]> {
  if (!detector) throw new Error('face detector not loaded');
  const fit = letterbox(sw, sh);
  inputCtx.setTransform(1, 0, 0, 1, 0, 0);
  inputCtx.fillStyle = '#000';
  inputCtx.fillRect(0, 0, YUNET_SIZE, YUNET_SIZE);
  inputCtx.drawImage(source, sx, sy, sw, sh, 0, 0, fit.width, fit.height);
  const data = inputCtx.getImageData(0, 0, YUNET_SIZE, YUNET_SIZE).data;
  const outputs = await detector.run({ [detector.inputNames[0] ?? 'input']: new ort.Tensor('float32', bgrTensor(data), [1, 3, YUNET_SIZE, YUNET_SIZE]) });
  return detectFaces(outputs as unknown as YunetOutputs, fit).map((f) => f.map((v, i) => (i < 14 ? v + (i % 2 === 0 ? sx : sy) : v)));
}

/** Whole image, and for big still pictures also an overlapping 2 x 2 grid, so small faces are found (offline mode). */
async function detectAll(source: Source, tiles: boolean): Promise<FaceRow[]> {
  const w = source.width;
  const h = source.height;
  const rows = await detectRegion(source, 0, 0, w, h);
  if (tiles && Math.max(w, h) > 960) {
    const tw = Math.ceil(w * 0.58);
    const th = Math.ceil(h * 0.58);
    for (const x of [0, w - tw]) for (const y of [0, h - th]) rows.push(...(await detectRegion(source, x, y, tw, th)));
    return nms(rows);
  }
  return rows;
}

function rotated(source: Source, k: number): Source {
  if (k % 4 === 0) return source;
  const w = source.width;
  const h = source.height;
  const [rw, rh] = rotatedSize(k, w, h);
  const canvas = new OffscreenCanvas(rw, rh);
  const ctx = canvas.getContext('2d') as OffscreenCanvasRenderingContext2D;
  ctx.translate(rw / 2, rh / 2);
  ctx.rotate((k * Math.PI) / 2);
  ctx.drawImage(source, -w / 2, -h / 2);
  return canvas;
}

/** SFace embedding of one face (OpenCV alignCrop + feature). */
async function feature(source: Source, face: FaceRow): Promise<Float32Array> {
  if (!recognizer) throw new Error('face recogniser not loaded');
  const m = alignTransform(face);
  cropCtx.setTransform(1, 0, 0, 1, 0, 0);
  cropCtx.fillStyle = '#000';
  cropCtx.fillRect(0, 0, SFACE_SIZE, SFACE_SIZE);
  cropCtx.setTransform(m[0], m[1], m[2], m[3], m[4], m[5]);
  cropCtx.drawImage(source, 0, 0);
  cropCtx.setTransform(1, 0, 0, 1, 0, 0);
  const data = cropCtx.getImageData(0, 0, SFACE_SIZE, SFACE_SIZE).data;
  const out = await recognizer.run({ [recognizer.inputNames[0] ?? 'data']: new ort.Tensor('float32', rgbTensor(data), [1, 3, SFACE_SIZE, SFACE_SIZE]) });
  const first = out[recognizer.outputNames[0] ?? 'fc1'];
  return new Float32Array(first ? (first.data as Float32Array) : []);
}

/** One heads pass: faces on the upright frame (k quarter turns), back in frame pixels, each scored when it may vote. */
async function faces(frame: ImageBitmap, k: number, tiles: boolean): Promise<ScoredFace[]> {
  const upright = rotated(frame, k);
  const found = (await detectAll(upright, tiles)).map((f) => unrotFace(f, k, frame.width, frame.height));
  const out: ScoredFace[] = [];
  for (const row of found) {
    let score: number | null = null;
    // Nobody chosen: every face is a stranger (upstream FaceGallery.score returns -1 without running SFace).
    if (shouldScore(row)) score = gallery.length && recognizer ? galleryScore(gallery, await feature(frame, row)) : -1;
    out.push({ row, score });
  }
  return out;
}

/** Upright probe: best face confidence + match to a chosen person, for each quarter turn. */
async function probe(frame: ImageBitmap): Promise<[number, number, number, number]> {
  const scores: [number, number, number, number] = [0, 0, 0, 0];
  for (let k = 0; k < 4; k += 1) {
    const upright = rotated(frame, k);
    const rows = await detectRegion(upright, 0, 0, upright.width, upright.height);
    const best = rows.reduce<FaceRow | null>((b, f) => (!b || at(f, 14) > at(b, 14) ? f : b), null);
    if (!best) continue;
    let match = 0;
    if (gallery.length && recognizer && shouldScore(best)) match = Math.max(0, galleryScore(gallery, await feature(upright, best)));
    scores[k] = at(best, 14) + match;
  }
  return scores;
}

const yoloInput = new OffscreenCanvas(YOLO_SIZE, YOLO_SIZE);
const yoloCtx = yoloInput.getContext('2d', { willReadFrequently: true }) as OffscreenCanvasRenderingContext2D;

/** One YOLO pass on a region (sx, sy, sw, sh) of `source`: the output tensor and how to map it back. */
async function yolo(session: ort.InferenceSession, source: Source, sx: number, sy: number, sw: number, sh: number) {
  const fit = yoloFit(sw, sh);
  yoloCtx.setTransform(1, 0, 0, 1, 0, 0);
  yoloCtx.fillStyle = `rgb(${String(YOLO_PAD)},${String(YOLO_PAD)},${String(YOLO_PAD)})`;
  yoloCtx.fillRect(0, 0, YOLO_SIZE, YOLO_SIZE);
  yoloCtx.drawImage(source, sx, sy, sw, sh, fit.padX, fit.padY, fit.width, fit.height);
  const data = yoloCtx.getImageData(0, 0, YOLO_SIZE, YOLO_SIZE).data;
  const out = await session.run({ [session.inputNames[0] ?? 'images']: new ort.Tensor('float32', rgbTensor01(data), [1, 3, YOLO_SIZE, YOLO_SIZE]) });
  const t = out[session.outputNames[0] ?? 'output0'];
  if (!t) throw new Error('model returned no output');
  return { data: t.data as Float32Array, dims: t.dims, fit };
}

const shiftBox = (b: Box, dx: number, dy: number): Box => [b[0] + dx, b[1] + dy, b[2] + dx, b[3] + dy];

/**
 * People, including people seen from behind (upstream HeadDetector._pose_heads): pose on the upright frame, a head
 * box from the keypoints (or the top of the body box), mapped back to frame pixels. Confidence .2, as upstream.
 * Still pictures also get the 2 x 2 tile pass, so small people in a big photo are found.
 */
async function people(frame: ImageBitmap, k: number, tiles: boolean): Promise<PoseFound[]> {
  if (!pose) throw new Error('people detector not loaded');
  const upright = rotated(frame, k);
  const w = upright.width;
  const h = upright.height;
  const regions: Array<[number, number, number, number]> = [[0, 0, w, h]];
  if (tiles && Math.max(w, h) > 960) {
    const tw = Math.ceil(w * 0.58);
    const th = Math.ceil(h * 0.58);
    for (const x of [0, w - tw]) for (const y of [0, h - th]) regions.push([x, y, tw, th]);
  }
  const found: PosePerson[] = [];
  for (const [x, y, rw, rh] of regions) {
    const r = await yolo(pose, upright, x, y, rw, rh);
    for (const p of decodePose(r.data, r.dims, r.fit, 0.2)) {
      const kp = p.kp.map((v, i) => (i % 3 === 0 ? v + x : i % 3 === 1 ? v + y : v));
      found.push({ box: shiftBox(p.box, x, y), score: p.score, kp });
    }
  }
  const kept = regions.length > 1 ? suppress(found, 0.6, false) : found;
  return kept.map((p) => ({ box: unrotBox(p.box, k, frame.width, frame.height), score: p.score, head: unrotBox(headBox(p.kp, p.box), k, frame.width, frame.height) }));
}

/** Screens, laptops, phones and paper (upstream CropZoom's YOLO11n pass, imgsz 640, conf .25). */
async function screenBoxes(frame: ImageBitmap): Promise<Box[]> {
  if (!screens) throw new Error('screen detector not loaded');
  const r = await yolo(screens, frame, 0, 0, frame.width, frame.height);
  return decodeDetections(r.data, r.dims, r.fit, SCREEN_CONF, SCREEN_CLASSES).map((d) => d.box);
}

/** Add people from a photo or a webcam frame: every face, a group split into one verified crop per person. */
async function enroll(image: ImageBitmap): Promise<EnrollResult> {
  const w = image.width;
  const h = image.height;
  const found = await detectAll(image, true);
  if (!found.length) return { people: [], split: true, found: 0 };
  const people = [];
  let split = true;
  for (const face of found) {
    const target = await feature(image, face);
    const [x, y, fw, fh] = [at(face, 0), at(face, 1), at(face, 2), at(face, 3)];
    let chosen: Box | null = null;
    if (found.length === 1) chosen = [Math.max(0, x - 0.2 * fw), Math.max(0, y - 0.2 * fh), Math.min(w, x + 1.2 * fw), Math.min(h, y + 1.2 * fh)];
    // Widest crop that still contains exactly this one person, and matches them at >= .65 (upstream split_group).
    for (const pad of [0.2, 0.1, 0]) {
      if (chosen) break;
      const b: Box = [Math.max(0, Math.trunc(x - pad * fw)), Math.max(0, Math.trunc(y - pad * fh)), Math.min(w, Math.trunc(x + (1 + pad) * fw)), Math.min(h, Math.trunc(y + (1 + pad) * fh))];
      if (b[2] - b[0] < 8 || b[3] - b[1] < 8) continue;
      const inCrop = await detectRegion(image, b[0], b[1], b[2] - b[0], b[3] - b[1]);
      const only = inCrop.length === 1 ? inCrop[0] : undefined;
      if (only && cosine(target, await feature(image, only)) >= 0.65) chosen = b;
    }
    if (!chosen) {
      split = false;
      chosen = xyxy(face);
    }
    people.push({ feature: [...target], box: chosen });
  }
  return { people, split, found: found.length };
}

/**
 * QR codes: decodable ones by the browser's BarcodeDetector or jsQR, plus codes that cannot be decoded, found by
 * their finder squares (finder.ts, in place of upstream's QRDet model). `shapes` counts the undecodable ones.
 */
async function qr(frame: ImageBitmap, tiles: boolean): Promise<{ boxes: Box[]; shapes: number }> {
  const decoded = await decodable(frame, tiles);
  const scale = Math.min(1, (tiles ? 1600 : 960) / Math.max(frame.width, frame.height));
  const cw = Math.max(1, Math.round(frame.width * scale));
  const ch = Math.max(1, Math.round(frame.height * scale));
  const canvas = new OffscreenCanvas(cw, ch);
  const ctx = canvas.getContext('2d', { willReadFrequently: true }) as OffscreenCanvasRenderingContext2D;
  ctx.drawImage(frame, 0, 0, cw, ch);
  const rgba = ctx.getImageData(0, 0, cw, ch).data;
  const gray = new Uint8Array(cw * ch);
  for (let i = 0; i < gray.length; i += 1) gray[i] = (77 * (rgba[4 * i] ?? 0) + 150 * (rgba[4 * i + 1] ?? 0) + 29 * (rgba[4 * i + 2] ?? 0)) >> 8;
  const shapes = findQrShapes(gray, cw, ch)
    .map((b): Box => [b[0] / scale, b[1] / scale, b[2] / scale, b[3] / scale])
    .filter((b) => decoded.every((d) => iou(d, b) < 0.3));
  return { boxes: [...decoded, ...shapes], shapes: shapes.length };
}

/** Decodable QR codes: the browser's BarcodeDetector where it exists, otherwise jsQR (repeated, blanking each code). */
async function decodable(frame: ImageBitmap, tiles: boolean): Promise<Box[]> {
  if (barcode) {
    const found = await barcode.detect(frame);
    return found.map((b) => [b.boundingBox.left, b.boundingBox.top, b.boundingBox.right, b.boundingBox.bottom]);
  }
  const scale = Math.min(1, (tiles ? 1600 : 960) / Math.max(frame.width, frame.height));
  const cw = Math.max(1, Math.round(frame.width * scale));
  const ch = Math.max(1, Math.round(frame.height * scale));
  const canvas = new OffscreenCanvas(cw, ch);
  const ctx = canvas.getContext('2d', { willReadFrequently: true }) as OffscreenCanvasRenderingContext2D;
  ctx.drawImage(frame, 0, 0, cw, ch);
  const boxes: Box[] = [];
  for (let n = 0; n < 6; n += 1) {
    const img = ctx.getImageData(0, 0, cw, ch);
    const code = jsQR(img.data, cw, ch, { inversionAttempts: 'attemptBoth' });
    if (!code) break;
    const l = code.location;
    const xs = [l.topLeftCorner.x, l.topRightCorner.x, l.bottomLeftCorner.x, l.bottomRightCorner.x];
    const ys = [l.topLeftCorner.y, l.topRightCorner.y, l.bottomLeftCorner.y, l.bottomRightCorner.y];
    const local: Box = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
    const box: Box = [local[0] / scale, local[1] / scale, local[2] / scale, local[3] / scale];
    if (boxes.some((b) => iou(b, box) > 0.5)) break;
    boxes.push(box);
    ctx.fillStyle = '#7f7f7f';
    ctx.fillRect(local[0] - 4, local[1] - 4, local[2] - local[0] + 8, local[3] - local[1] + 8);
  }
  return boxes;
}

async function handle(req: VisionRequest): Promise<VisionResult> {
  switch (req.type) {
    case 'init':
      return { type: 'init', result: await init(req) };
    case 'gallery':
      gallery = req.features.map((f) => new Float32Array(f));
      return { type: 'gallery', count: gallery.length };
    case 'faces':
      try {
        return { type: 'faces', faces: await faces(req.frame, req.k, req.tiles) };
      } finally {
        req.frame.close();
      }
    case 'probe':
      try {
        return { type: 'probe', scores: await probe(req.frame) };
      } finally {
        req.frame.close();
      }
    case 'enroll':
      try {
        return { type: 'enroll', result: await enroll(req.image) };
      } finally {
        req.image.close();
      }
    case 'qr':
      try {
        return { type: 'qr', ...(await qr(req.frame, req.tiles)) };
      } finally {
        req.frame.close();
      }
    case 'pose':
      try {
        return { type: 'pose', people: await people(req.frame, req.k, req.tiles) };
      } finally {
        req.frame.close();
      }
    case 'screens':
      try {
        return { type: 'screens', boxes: await screenBoxes(req.frame) };
      } finally {
        req.frame.close();
      }
  }
}

self.onmessage = (event: MessageEvent<{ id: number; req: VisionRequest }>) => {
  const { id, req } = event.data;
  handle(req).then(
    (body) => {
      self.postMessage({ id, ok: true, body } satisfies Envelope<VisionResult>);
    },
    (error: unknown) => {
      self.postMessage({ id, ok: false, error: message(error) } satisfies Envelope<VisionResult>);
    },
  );
};
