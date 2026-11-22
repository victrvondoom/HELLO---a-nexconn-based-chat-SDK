// SPDX-License-Identifier: AGPL-3.0-only
// Adapted from Offleak (https://github.com/azharizz/offleak, commit 24e6a77, app/offleak/redaction/flow.py), AGPL-3.0.
// Upstream calls OpenCV's calcOpticalFlowPyrLK; this file implements the same pyramidal Lucas-Kanade in TypeScript.

import { at, type Box } from './geometry';

/**
 * Sparse optical flow that carries blur boxes onto the frames between detector runs. Points sit on a fixed grid
 * (every `step` pixels of the full frame); flow runs on a half-resolution grayscale copy, so callers pass that.
 */

export interface Gray {
  width: number;
  height: number;
  data: Float32Array;
}

/** Grid points in full-frame pixels, as [x0, y0, x1, y1, ...]. */
export function gridPoints(w: number, h: number, step = 40): Float32Array {
  const xs: number[] = [];
  const ys: number[] = [];
  for (let y = step / 2; y < h; y += step) ys.push(y);
  for (let x = step / 2; x < w; x += step) xs.push(x);
  const pts = new Float32Array(xs.length * ys.length * 2);
  let k = 0;
  for (const y of ys) {
    for (const x of xs) {
      pts[k++] = x;
      pts[k++] = y;
    }
  }
  return pts;
}

/** Luma of RGBA pixels (as the browser hands them over), at whatever size they were drawn. */
export function grayFromRgba(rgba: Uint8ClampedArray | Uint8Array, width: number, height: number): Gray {
  const data = new Float32Array(width * height);
  for (let i = 0, p = 0; i < data.length; i += 1, p += 4) data[i] = 0.299 * at(rgba, p) + 0.587 * at(rgba, p + 1) + 0.114 * at(rgba, p + 2);
  return { width, height, data };
}

function downsample(g: Gray): Gray {
  const width = Math.max(1, Math.floor(g.width / 2));
  const height = Math.max(1, Math.floor(g.height / 2));
  const data = new Float32Array(width * height);
  const src = g.data;
  for (let y = 0; y < height; y += 1) {
    const y0 = Math.min(g.height - 1, 2 * y) * g.width;
    const y1 = Math.min(g.height - 1, 2 * y + 1) * g.width;
    for (let x = 0; x < width; x += 1) {
      const x0 = Math.min(g.width - 1, 2 * x);
      const x1 = Math.min(g.width - 1, 2 * x + 1);
      data[y * width + x] = (at(src, y0 + x0) + at(src, y0 + x1) + at(src, y1 + x0) + at(src, y1 + x1)) / 4;
    }
  }
  return { width, height, data };
}

/** A pyramid level with its central-difference gradients, computed once per frame and reused by every point. */
export interface Level extends Gray {
  gx: Float32Array;
  gy: Float32Array;
}

function withGradients(g: Gray): Level {
  const { width: w, height: h, data } = g;
  const gx = new Float32Array(w * h);
  const gy = new Float32Array(w * h);
  for (let y = 0; y < h; y += 1) {
    const up = Math.max(0, y - 1) * w;
    const down = Math.min(h - 1, y + 1) * w;
    const row = y * w;
    for (let x = 0; x < w; x += 1) {
      gx[row + x] = (at(data, row + Math.min(w - 1, x + 1)) - at(data, row + Math.max(0, x - 1))) / 2;
      gy[row + x] = (at(data, down + x) - at(data, up + x)) / 2;
    }
  }
  return { ...g, gx, gy };
}

export function pyramid(g: Gray, levels: number): Level[] {
  const out = [withGradients(g)];
  let last = g;
  for (let l = 1; l <= levels && last.width >= 16 && last.height >= 16; l += 1) {
    last = downsample(last);
    out.push(withGradients(last));
  }
  return out;
}

/** Bilinear read of `img` (w x h) at (x, y), clamped to the border. */
function bilinear(img: Float32Array, w: number, h: number, x: number, y: number): number {
  const cx = x < 0 ? 0 : x > w - 1.001 ? w - 1.001 : x;
  const cy = y < 0 ? 0 : y > h - 1.001 ? h - 1.001 : y;
  const x0 = cx | 0;
  const y0 = cy | 0;
  const fx = cx - x0;
  const fy = cy - y0;
  const i = y0 * w + x0;
  const a = img[i] ?? 0;
  const b = img[i + 1] ?? 0;
  const c = img[i + w] ?? 0;
  const d = img[i + w + 1] ?? 0;
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

/**
 * Pyramidal Lucas-Kanade for each point (half-resolution coordinates), coarse to fine. Returns the tracked positions
 * and a status flag per point (1 tracked, 0 lost). `win` is the window side (15 upstream), `levels` the extra pyramid
 * levels (3 upstream), and iteration stops when the update is under 0.1 px (OpenCV's default epsilon is 0.01).
 */
export function lucasKanade(prev: Level[], next: Level[], pts: Float32Array, win = 15, levels = 3, iterations = 20): { out: Float32Array; status: Uint8Array } {
  const n = pts.length / 2;
  const out = new Float32Array(pts.length);
  const status = new Uint8Array(n);
  const r = Math.floor(win / 2);
  const top = Math.min(levels, prev.length - 1, next.length - 1);
  const base = prev[0];
  const area = win * win;
  const ix = new Float32Array(area);
  const iy = new Float32Array(area);
  const iv = new Float32Array(area);
  for (let p = 0; p < n; p += 1) {
    let gx = 0;
    let gy = 0;
    let ok = base !== undefined;
    for (let l = top; l >= 0 && ok; l -= 1) {
      const A = prev[l];
      const B = next[l];
      if (!A || !B) {
        ok = false;
        break;
      }
      const scale = 1 / (1 << l);
      const px = at(pts, 2 * p) * scale;
      const py = at(pts, 2 * p + 1) * scale;
      let gxx = 0;
      let gxy = 0;
      let gyy = 0;
      let k = 0;
      for (let dy = -r; dy <= r; dy += 1) {
        for (let dx = -r; dx <= r; dx += 1) {
          const ex = bilinear(A.gx, A.width, A.height, px + dx, py + dy);
          const ey = bilinear(A.gy, A.width, A.height, px + dx, py + dy);
          ix[k] = ex;
          iy[k] = ey;
          iv[k] = bilinear(A.data, A.width, A.height, px + dx, py + dy);
          gxx += ex * ex;
          gxy += ex * ey;
          gyy += ey * ey;
          k += 1;
        }
      }
      const det = gxx * gyy - gxy * gxy;
      // smallest eigenvalue of the structure tensor, per pixel: a flat window cannot be tracked
      const minEig = (gxx + gyy - Math.sqrt((gxx - gyy) * (gxx - gyy) + 4 * gxy * gxy)) / (2 * area);
      if (det < 1e-6 || minEig < 1e-3) {
        ok = false;
        break;
      }
      let vx = 0;
      let vy = 0;
      for (let it = 0; it < iterations; it += 1) {
        let bx = 0;
        let by = 0;
        k = 0;
        const ox = px + gx + vx;
        const oy = py + gy + vy;
        for (let dy = -r; dy <= r; dy += 1) {
          for (let dx = -r; dx <= r; dx += 1) {
            const diff = (iv[k] ?? 0) - bilinear(B.data, B.width, B.height, ox + dx, oy + dy);
            bx += diff * (ix[k] ?? 0);
            by += diff * (iy[k] ?? 0);
            k += 1;
          }
        }
        const ux = (gyy * bx - gxy * by) / det;
        const uy = (gxx * by - gxy * bx) / det;
        vx += ux;
        vy += uy;
        if (ux * ux + uy * uy < 1e-2) break;
      }
      if (l > 0) {
        gx = 2 * (gx + vx);
        gy = 2 * (gy + vy);
      } else {
        gx += vx;
        gy += vy;
      }
    }
    const x = at(pts, 2 * p) + gx;
    const y = at(pts, 2 * p + 1) + gy;
    out[2 * p] = x;
    out[2 * p + 1] = y;
    status[p] = ok && base && Number.isFinite(x) && Number.isFinite(y) && x >= 0 && y >= 0 && x < base.width && y < base.height ? 1 : 0;
  }
  return { out, status };
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? at(s, m) : (at(s, m - 1) + at(s, m)) / 2;
}

/**
 * Lucas-Kanade on a fixed grid at half resolution; `step(gray)` returns each grid point's displacement in full-frame
 * pixels since the previous frame (zero on the first frame). Lost points take the median of the tracked ones.
 */
export class GridFlow {
  readonly pts: Float32Array;
  private readonly half: Float32Array;
  private prev: Level[] | null = null;

  constructor(w: number, h: number, step = 40) {
    this.pts = gridPoints(w, h, step);
    this.half = this.pts.map((v) => v * 0.5);
  }

  step(halfGray: Gray): Float32Array {
    const levels = pyramid(halfGray, 3);
    const d = new Float32Array(this.pts.length);
    if (this.prev) {
      const { out, status } = lucasKanade(this.prev, levels, this.half);
      const gx: number[] = [];
      const gy: number[] = [];
      for (let p = 0; p < status.length; p += 1) {
        if (!status[p]) continue;
        const dx = (at(out, 2 * p) - at(this.half, 2 * p)) / 0.5;
        const dy = (at(out, 2 * p + 1) - at(this.half, 2 * p + 1)) / 0.5;
        d[2 * p] = dx;
        d[2 * p + 1] = dy;
        gx.push(dx);
        gy.push(dy);
      }
      const mx = median(gx);
      const my = median(gy);
      for (let p = 0; p < status.length; p += 1) {
        if (status[p]) continue;
        d[2 * p] = mx;
        d[2 * p + 1] = my;
      }
    }
    this.prev = levels;
    return d;
  }
}

/** Shift a box by the median displacement of grid points inside it (nearest 4 when fewer than 3 are inside). */
export function move(box: Box, disp: Float32Array, pts: Float32Array, sign: 1 | -1): Box {
  const [x1, y1, x2, y2] = box;
  const n = pts.length / 2;
  let sel: number[] = [];
  for (let p = 0; p < n; p += 1) {
    const x = at(pts, 2 * p);
    const y = at(pts, 2 * p + 1);
    if (x >= x1 && x <= x2 && y >= y1 && y <= y2) sel.push(p);
  }
  if (sel.length < 3) {
    const cx = (x1 + x2) / 2;
    const cy = (y1 + y2) / 2;
    sel = [...Array(n).keys()]
      .map((p) => [p, (at(pts, 2 * p) - cx) ** 2 + (at(pts, 2 * p + 1) - cy) ** 2] as const)
      .sort((a, b) => a[1] - b[1])
      .slice(0, 4)
      .map(([p]) => p);
  }
  const dx = median(sel.map((p) => at(disp, 2 * p))) * sign;
  const dy = median(sel.map((p) => at(disp, 2 * p + 1))) * sign;
  return [x1 + dx, y1 + dy, x2 + dx, y2 + dy];
}
