/**
 * YuNet face detector (OpenCV Zoo, face_detection_yunet_2023mar.onnx, MIT) output decoding, as OpenCV's
 * FaceDetectorYN does it (modules/objdetect/src/face_detect.cpp). Upstream Offleak calls that OpenCV class with
 * score threshold .6, NMS threshold .3 and top-k 5000; the same values are used here.
 *
 * The ONNX file takes a fixed 1x3x640x640 BGR float input (0-255). Frames are letterboxed: scaled to fit,
 * placed at the top-left, the rest left black. Rows come back in frame pixels in the YuNet layout
 * [x, y, w, h, 5 landmarks (x, y), score].
 */

import { at, iou, type Box, type FaceRow } from './geometry';

export const YUNET_SIZE = 640;
export const YUNET_STRIDES = [8, 16, 32] as const;
export const SCORE_THRESHOLD = 0.6;
export const NMS_THRESHOLD = 0.3;
export const TOP_K = 5000;

export interface Letterbox {
  scale: number;
  width: number;
  height: number;
}

/** How a w x h frame fits in the 640 x 640 input. */
export function letterbox(w: number, h: number, size = YUNET_SIZE): Letterbox {
  const scale = Math.min(size / w, size / h);
  return { scale, width: Math.round(w * scale), height: Math.round(h * scale) };
}

/** RGBA pixels of the letterboxed input -> planar BGR float tensor data. */
export function bgrTensor(rgba: Uint8ClampedArray | Uint8Array, size = YUNET_SIZE): Float32Array {
  const plane = size * size;
  const out = new Float32Array(3 * plane);
  for (let i = 0, p = 0; i < plane; i += 1, p += 4) {
    out[i] = at(rgba, p + 2);
    out[plane + i] = at(rgba, p + 1);
    out[2 * plane + i] = at(rgba, p);
  }
  return out;
}

export type YunetOutputs = Record<string, { data: Float32Array | ArrayLike<number> }>;

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** Decode the 12 YuNet outputs into candidate faces (input pixels), before NMS. */
export function decode(outputs: YunetOutputs, size = YUNET_SIZE, threshold = SCORE_THRESHOLD): FaceRow[] {
  const faces: FaceRow[] = [];
  for (const stride of YUNET_STRIDES) {
    const cols = Math.floor(size / stride);
    const rows = Math.floor(size / stride);
    const cls = outputs[`cls_${stride}`]?.data ?? [];
    const obj = outputs[`obj_${stride}`]?.data ?? [];
    const bbox = outputs[`bbox_${stride}`]?.data ?? [];
    const kps = outputs[`kps_${stride}`]?.data ?? [];
    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        const idx = r * cols + c;
        const score = Math.sqrt(clamp01(at(cls, idx)) * clamp01(at(obj, idx)));
        if (score < threshold) continue;
        const cx = (c + at(bbox, idx * 4)) * stride;
        const cy = (r + at(bbox, idx * 4 + 1)) * stride;
        const w = Math.exp(at(bbox, idx * 4 + 2)) * stride;
        const h = Math.exp(at(bbox, idx * 4 + 3)) * stride;
        const row: FaceRow = [cx - w / 2, cy - h / 2, w, h];
        for (let n = 0; n < 5; n += 1) row.push((at(kps, idx * 10 + 2 * n) + c) * stride, (at(kps, idx * 10 + 2 * n + 1) + r) * stride);
        row.push(score);
        faces.push(row);
      }
    }
  }
  return faces;
}

/** Greedy non-maximum suppression by score (OpenCV NMSBoxes). */
export function nms(faces: FaceRow[], threshold = NMS_THRESHOLD, topK = TOP_K): FaceRow[] {
  const sorted = [...faces].sort((a, b) => at(b, 14) - at(a, 14)).slice(0, topK);
  const kept: FaceRow[] = [];
  const box = (f: FaceRow): Box => [at(f, 0), at(f, 1), at(f, 0) + at(f, 2), at(f, 1) + at(f, 3)];
  for (const f of sorted) if (kept.every((k) => iou(box(k), box(f)) <= threshold)) kept.push(f);
  return kept;
}

/** Input pixels -> frame pixels; faces whose centre lies in the black padding are dropped. */
export function toFrame(faces: FaceRow[], fit: Letterbox): FaceRow[] {
  return faces
    .filter((f) => at(f, 0) + at(f, 2) / 2 < fit.width && at(f, 1) + at(f, 3) / 2 < fit.height)
    .map((f) => [...f.slice(0, 14).map((v) => v / fit.scale), at(f, 14)]);
}

export function detectFaces(outputs: YunetOutputs, fit: Letterbox): FaceRow[] {
  return toFrame(nms(decode(outputs)), fit);
}
