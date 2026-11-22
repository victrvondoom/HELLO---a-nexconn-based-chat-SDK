import { iou, type Box } from './geometry';

/**
 * Decoding for Ultralytics YOLO ONNX exports (written for HELLO; no Offleak code). Two layouts are used:
 *
 * - detection `[1, 4 + classes, anchors]` (YOLO11n, COCO: screens, laptops, phones and paper for crop zoom)
 * - pose      `[1, 4 + 1 + 17 * 3, anchors]` (YOLOv8n-pose: people, including people seen from behind)
 *
 * Value `c` of anchor `a` is `data[c * anchors + a]`. Boxes are centre x, y, width, height in the 640 x 640
 * letterboxed input. Pure: no ONNX Runtime, no canvas.
 */

export const YOLO_SIZE = 640;
/** Ultralytics pads letterboxed inputs with this grey. */
export const YOLO_PAD = 114;

export interface YoloFit {
  /** Input pixels per source pixel. */
  scale: number;
  padX: number;
  padY: number;
  /** Size of the scaled picture inside the square input. */
  width: number;
  height: number;
}

/** Centred letterbox, as Ultralytics `LetterBox(auto=False)` does for a fixed-size export. */
export function yoloFit(w: number, h: number, size = YOLO_SIZE): YoloFit {
  const scale = Math.min(size / w, size / h);
  const width = Math.round(w * scale);
  const height = Math.round(h * scale);
  return { scale, padX: Math.floor((size - width) / 2), padY: Math.floor((size - height) / 2), width, height };
}

/** RGBA pixels of the square input -> CHW float RGB in [0, 1]. */
export function rgbTensor01(rgba: Uint8ClampedArray | Uint8Array, size = YOLO_SIZE): Float32Array {
  const n = size * size;
  const out = new Float32Array(3 * n);
  for (let i = 0; i < n; i += 1) {
    out[i] = (rgba[4 * i] ?? 0) / 255;
    out[n + i] = (rgba[4 * i + 1] ?? 0) / 255;
    out[2 * n + i] = (rgba[4 * i + 2] ?? 0) / 255;
  }
  return out;
}

export interface Detection {
  box: Box;
  score: number;
  cls: number;
}

export interface PosePerson {
  box: Box;
  score: number;
  /** 17 COCO keypoints as x, y, confidence (51 numbers), in source pixels. */
  kp: number[];
}

const back = (fit: YoloFit, x: number, y: number): [number, number] => [(x - fit.padX) / fit.scale, (y - fit.padY) / fit.scale];

function boxAt(data: ArrayLike<number>, anchors: number, a: number, fit: YoloFit): Box {
  const cx = data[a] ?? 0;
  const cy = data[anchors + a] ?? 0;
  const w = data[2 * anchors + a] ?? 0;
  const h = data[3 * anchors + a] ?? 0;
  const [x1, y1] = back(fit, cx - w / 2, cy - h / 2);
  const [x2, y2] = back(fit, cx + w / 2, cy + h / 2);
  return [x1, y1, x2, y2];
}

/** Greedy non-maximum suppression, highest score first (per class when `perClass`). */
export function suppress<T extends { box: Box; score: number; cls?: number }>(items: T[], threshold = 0.45, perClass = true): T[] {
  const kept: T[] = [];
  for (const item of [...items].sort((a, b) => b.score - a.score)) {
    if (kept.every((k) => (perClass && k.cls !== item.cls) || iou(k.box, item.box) <= threshold)) kept.push(item);
  }
  return kept;
}

/** Detection output -> boxes of the wanted classes above `conf`, in source pixels. */
export function decodeDetections(data: ArrayLike<number>, dims: readonly number[], fit: YoloFit, conf: number, classes?: readonly number[]): Detection[] {
  const channels = dims[1] ?? 0;
  const anchors = dims[2] ?? 0;
  const wanted = classes ?? Array.from({ length: channels - 4 }, (_, i) => i);
  const found: Detection[] = [];
  for (let a = 0; a < anchors; a += 1) {
    let best = -1;
    let score = conf;
    for (const c of wanted) {
      const s = data[(4 + c) * anchors + a] ?? 0;
      if (s >= score) {
        score = s;
        best = c;
      }
    }
    if (best >= 0) found.push({ box: boxAt(data, anchors, a, fit), score, cls: best });
  }
  return suppress(found);
}

/** Pose output -> people above `conf` with their keypoints, in source pixels. */
export function decodePose(data: ArrayLike<number>, dims: readonly number[], fit: YoloFit, conf: number): PosePerson[] {
  const anchors = dims[2] ?? 0;
  const found: PosePerson[] = [];
  for (let a = 0; a < anchors; a += 1) {
    const score = data[4 * anchors + a] ?? 0;
    if (score < conf) continue;
    const kp: number[] = [];
    for (let k = 0; k < 17; k += 1) {
      const [x, y] = back(fit, data[(5 + 3 * k) * anchors + a] ?? 0, data[(6 + 3 * k) * anchors + a] ?? 0);
      kp.push(x, y, data[(7 + 3 * k) * anchors + a] ?? 0);
    }
    found.push({ box: boxAt(data, anchors, a, fit), score, kp });
  }
  return suppress(found, 0.7, false);
}
