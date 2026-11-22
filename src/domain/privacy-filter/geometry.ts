// SPDX-License-Identifier: AGPL-3.0-only
// Adapted from Offleak (https://github.com/azharizz/offleak, commit 24e6a77, app/offleak/geometry.py), AGPL-3.0.

/**
 * Box and orientation maths for the privacy filter. Pure: no canvas, no clock.
 *
 * Boxes are `[x1, y1, x2, y2]` in pixels. Face rows use the YuNet layout:
 * `[x, y, w, h, rightEyeX, rightEyeY, leftEyeX, leftEyeY, noseX, noseY, rightMouthX, rightMouthY, leftMouthX, leftMouthY, score]`.
 */

export type Box = [number, number, number, number];
/** 15 numbers: box (x, y, w, h), five landmarks, score. */
export type FaceRow = number[];

/** Indexed read that is 0 past the end (the repo enables noUncheckedIndexedAccess and forbids `!`). */
export const at = (a: ArrayLike<number>, i: number): number => a[i] ?? 0;

export function iou(a: Box, b: Box): number {
  const inter = Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])) * Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
  return inter / Math.max(1e-6, (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter);
}

export function xyxy(face: FaceRow): Box {
  return [at(face, 0), at(face, 1), at(face, 0) + at(face, 2), at(face, 1) + at(face, 3)];
}

export function area(box: Box): number {
  return (box[2] - box[0]) * (box[3] - box[1]);
}

export function clip(box: Box, w: number, h: number): Box {
  return [Math.max(0, Math.trunc(box[0])), Math.max(0, Math.trunc(box[1])), Math.min(w, Math.trunc(box[2])), Math.min(h, Math.trunc(box[3]))];
}

/** Normalized top-left-origin rect inside an (x0, y0, w, h) region -> pixel box. */
export function denorm(rect: Box, x0: number, y0: number, w: number, h: number): Box {
  return [Math.trunc(x0 + rect[0] * w), Math.trunc(y0 + rect[1] * h), Math.trunc(x0 + rect[2] * w) + 1, Math.trunc(y0 + rect[3] * h) + 1];
}

/** A box found on a flipped image -> the same box on the original image. */
export function unflip(box: Box, hf: boolean, vf: boolean, w: number, h: number): Box {
  let [x1, y1, x2, y2] = box;
  if (hf) [x1, x2] = [w - x2, w - x1];
  if (vf) [y1, y2] = [h - y2, h - y1];
  return [x1, y1, x2, y2];
}

/** Size of a w x h frame after k clockwise quarter turns. */
export function rotatedSize(k: number, w: number, h: number): [number, number] {
  return ((k % 4) + 4) % 2 === 1 ? [h, w] : [w, h];
}

/** Map a point from a frame rotated k quarter turns clockwise back to the original w x h frame. */
export function unrotPoint(x: number, y: number, k: number, w: number, h: number): [number, number] {
  switch (((k % 4) + 4) % 4) {
    case 1:
      return [y, h - 1 - x];
    case 2:
      return [w - 1 - x, h - 1 - y];
    case 3:
      return [w - 1 - y, x];
    default:
      return [x, y];
  }
}

export function unrotBox(box: Box, k: number, w: number, h: number): Box {
  const [ax, ay] = unrotPoint(box[0], box[1], k, w, h);
  const [bx, by] = unrotPoint(box[2], box[3], k, w, h);
  return [Math.min(ax, bx), Math.min(ay, by), Math.max(ax, bx), Math.max(ay, by)];
}

/** A face row found on a rotated frame -> the same face in original coordinates (landmarks keep their identity). */
export function unrotFace(face: FaceRow, k: number, w: number, h: number): FaceRow {
  const [x1, y1, x2, y2] = unrotBox(xyxy(face), k, w, h);
  const marks: number[] = [];
  for (let i = 0; i < 5; i += 1) marks.push(...unrotPoint(at(face, 4 + 2 * i), at(face, 5 + 2 * i), k, w, h));
  return [x1, y1, x2 - x1, y2 - y1, ...marks, at(face, 14)];
}

/** True when the eyes are wide apart and the nose sits between them (not a profile). Works at any roll. */
export function frontal(face: FaceRow): boolean {
  const vx = at(face, 6) - at(face, 4);
  const vy = at(face, 7) - at(face, 5);
  const eye = Math.hypot(vx, vy);
  const ux = vx / Math.max(eye, 1e-6);
  const uy = vy / Math.max(eye, 1e-6);
  const mx = (at(face, 4) + at(face, 6)) / 2;
  const my = (at(face, 5) + at(face, 7)) / 2;
  const off = Math.abs((at(face, 8) - mx) * ux + (at(face, 9) - my) * uy);
  return eye / Math.sqrt(at(face, 2) * at(face, 3)) >= 0.28 && off / Math.max(1, eye) <= 0.6;
}

/** Grow a box by `frac` of its longer side (at least `minpad` pixels), clamped to the frame (Redactor `fill`). */
export function padBox(box: Box, frac: number, minpad: number, w: number, h: number): Box {
  const pad = Math.max(minpad, Math.trunc(Math.max(box[2] - box[0], box[3] - box[1]) * frac));
  return [Math.max(0, box[0] - pad), Math.max(0, box[1] - pad), Math.min(w - 1, box[2] + pad), Math.min(h - 1, box[3] + pad)];
}
