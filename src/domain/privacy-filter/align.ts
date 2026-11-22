/**
 * Face alignment for SFace (OpenCV Zoo, face_recognition_sface_2021dec.onnx, Apache-2.0), as OpenCV's
 * FaceRecognizerSF::alignCrop does it: a similarity transform (rotation, uniform scale, translation) that maps the
 * five YuNet landmarks onto the ArcFace 112 x 112 template, estimated with Umeyama's method.
 *
 * The SFace input is 1x3x112x112, RGB float 0-255 (OpenCV builds it with swapRB from a BGR crop).
 */

import { at, type FaceRow } from './geometry';

export const SFACE_SIZE = 112;
/** Right eye, left eye, nose, right mouth corner, left mouth corner. */
export const TEMPLATE: ReadonlyArray<readonly [number, number]> = [
  [38.2946, 51.6963],
  [73.5318, 51.5014],
  [56.0252, 71.7366],
  [41.5493, 92.3655],
  [70.7299, 92.2041],
];

/** Canvas-style affine [a, b, c, d, e, f]: x' = a x + c y + e, y' = b x + d y + f. */
export type Affine = [number, number, number, number, number, number];

/** Least-squares similarity transform taking `src` points onto `dst` points (Umeyama 1991, 2D). */
export function similarity(src: ReadonlyArray<readonly [number, number]>, dst: ReadonlyArray<readonly [number, number]>): Affine {
  const n = Math.min(src.length, dst.length);
  const pairs = src.slice(0, n).map((s, i) => [s, dst[i] ?? s] as const);
  let sx = 0;
  let sy = 0;
  let dx = 0;
  let dy = 0;
  for (const [s, d] of pairs) {
    sx += s[0];
    sy += s[1];
    dx += d[0];
    dy += d[1];
  }
  sx /= n;
  sy /= n;
  dx /= n;
  dy /= n;
  // a = sum(s . d), b = sum(s x d), v = sum |s|^2 over centred points
  let a = 0;
  let b = 0;
  let v = 0;
  for (const [s, d] of pairs) {
    const px = s[0] - sx;
    const py = s[1] - sy;
    const qx = d[0] - dx;
    const qy = d[1] - dy;
    a += px * qx + py * qy;
    b += px * qy - py * qx;
    v += px * px + py * py;
  }
  const c = a / Math.max(v, 1e-12); // scale * cos
  const s = b / Math.max(v, 1e-12); // scale * sin
  return [c, s, -s, c, dx - (c * sx - s * sy), dy - (s * sx + c * sy)];
}

export function landmarks(face: FaceRow): Array<[number, number]> {
  return [0, 1, 2, 3, 4].map((i) => [at(face, 4 + 2 * i), at(face, 5 + 2 * i)]);
}

export function alignTransform(face: FaceRow): Affine {
  return similarity(landmarks(face), TEMPLATE);
}

export function apply(m: Affine, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

/** RGBA pixels of the 112 x 112 aligned crop -> planar RGB float tensor data. */
export function rgbTensor(rgba: Uint8ClampedArray | Uint8Array, size = SFACE_SIZE): Float32Array {
  const plane = size * size;
  const out = new Float32Array(3 * plane);
  for (let i = 0, p = 0; i < plane; i += 1, p += 4) {
    out[i] = at(rgba, p);
    out[plane + i] = at(rgba, p + 1);
    out[2 * plane + i] = at(rgba, p + 2);
  }
  return out;
}
