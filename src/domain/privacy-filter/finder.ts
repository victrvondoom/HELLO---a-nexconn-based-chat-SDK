import { iou, type Box } from './geometry';

/**
 * QR codes that cannot be decoded (written for HELLO; no Offleak or QRDet code).
 *
 * Upstream Offleak finds undecodable codes with QRDet, a YOLO model whose weights are only published as PyTorch
 * files; there is no ONNX export a browser can load (see docs/THIRD_PARTY_LICENSE_AUDIT.md). This is the classic
 * alternative every QR reader starts with: find the three finder squares (dark-light-dark-light-dark runs in a
 * 1:1:3:1:1 ratio, across and down), then three of them that form the right-angled corner of a square. It needs
 * the finder squares, not the data: a code that is blurred, damaged, partly covered or too low-contrast to decode
 * is still found as long as its corners are visible. It does not find a code whose finder squares are hidden.
 *
 * A false match only blurs a little more of the picture, which is the safe direction.
 */

export interface FinderCenter {
  x: number;
  y: number;
  /** Module (one QR cell) size in pixels. */
  module: number;
  /** Rows that confirmed it. */
  hits: number;
}

/** Dark pixels by local mean: a pixel is dark when below 90% of the mean of its neighbourhood. */
export function binarize(gray: Uint8Array | Uint8ClampedArray, w: number, h: number, radius = Math.max(7, Math.round(Math.min(w, h) / 24))): Uint8Array {
  const integral = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y += 1) {
    let row = 0;
    for (let x = 0; x < w; x += 1) {
      row += gray[y * w + x] ?? 0;
      integral[(y + 1) * (w + 1) + x + 1] = (integral[y * (w + 1) + x + 1] ?? 0) + row;
    }
  }
  const dark = new Uint8Array(w * h);
  for (let y = 0; y < h; y += 1) {
    const y0 = Math.max(0, y - radius);
    const y1 = Math.min(h, y + radius + 1);
    for (let x = 0; x < w; x += 1) {
      const x0 = Math.max(0, x - radius);
      const x1 = Math.min(w, x + radius + 1);
      const sum = (integral[y1 * (w + 1) + x1] ?? 0) - (integral[y0 * (w + 1) + x1] ?? 0) - (integral[y1 * (w + 1) + x0] ?? 0) + (integral[y0 * (w + 1) + x0] ?? 0);
      const mean = sum / ((x1 - x0) * (y1 - y0));
      dark[y * w + x] = (gray[y * w + x] ?? 0) < mean * 0.9 ? 1 : 0;
    }
  }
  return dark;
}

/** True when five runs are 1:1:3:1:1 within half a module each (one and a half for the centre). */
export function finderRatio(runs: readonly number[]): boolean {
  const total = runs.reduce((s, r) => s + r, 0);
  if (total < 7) return false;
  const m = total / 7;
  const tol = m / 2;
  return Math.abs((runs[0] ?? 0) - m) < tol && Math.abs((runs[1] ?? 0) - m) < tol && Math.abs((runs[2] ?? 0) - 3 * m) < 3 * tol && Math.abs((runs[3] ?? 0) - m) < tol && Math.abs((runs[4] ?? 0) - m) < tol;
}

/** Vertical runs through (x, cy): the same pattern down the column. Returns its centre y and length, or null. */
function crossCheck(dark: Uint8Array, w: number, h: number, x: number, cy: number, maxRun: number): { y: number; total: number } | null {
  const px = (y: number) => dark[y * w + x] ?? 0;
  if (!px(cy)) return null;
  const runs = [0, 0, 0, 0, 0];
  const grow = (i: number) => {
    runs[i] = (runs[i] ?? 0) + 1;
  };
  let y = cy;
  while (y >= 0 && px(y)) { grow(2); y -= 1; }
  while (y >= 0 && !px(y) && (runs[1] ?? 0) <= maxRun) { grow(1); y -= 1; }
  while (y >= 0 && px(y) && (runs[0] ?? 0) <= maxRun) { grow(0); y -= 1; }
  const top = y + 1;
  y = cy + 1;
  while (y < h && px(y)) { grow(2); y += 1; }
  while (y < h && !px(y) && (runs[3] ?? 0) <= maxRun) { grow(3); y += 1; }
  while (y < h && px(y) && (runs[4] ?? 0) <= maxRun) { grow(4); y += 1; }
  if (!finderRatio(runs)) return null;
  return { y: top + (runs[0] ?? 0) + (runs[1] ?? 0) + (runs[2] ?? 0) / 2, total: runs.reduce((s, r) => s + r, 0) };
}

function addCenter(found: FinderCenter[], x: number, y: number, module: number): void {
  for (const c of found) {
    if (Math.abs(c.x - x) <= 2 * module && Math.abs(c.y - y) <= 2 * module && Math.abs(c.module - module) <= module) {
      c.x = (c.x * c.hits + x) / (c.hits + 1);
      c.y = (c.y * c.hits + y) / (c.hits + 1);
      c.module = (c.module * c.hits + module) / (c.hits + 1);
      c.hits += 1;
      return;
    }
  }
  found.push({ x, y, module, hits: 1 });
}

/** Centres of finder squares in a binarized picture (confirmed by at least two rows). */
export function findCenters(dark: Uint8Array, w: number, h: number): FinderCenter[] {
  const found: FinderCenter[] = [];
  for (let y = 0; y < h; y += 1) {
    const runs: number[] = [];
    const starts: number[] = [];
    let x = 0;
    while (x < w) {
      const v = dark[y * w + x] ?? 0;
      const start = x;
      while (x < w && (dark[y * w + x] ?? 0) === v) x += 1;
      if (!runs.length && !v) continue; // patterns start on a dark run
      runs.push(x - start);
      starts.push(start);
      // windows of five that start on a dark run end at odd lengths of the run list
      if (runs.length >= 5 && (runs.length - 5) % 2 === 0) {
        const five = runs.slice(-5);
        if (!finderRatio(five)) continue;
        const s0 = starts[starts.length - 5] ?? 0;
        const total = five.reduce((s, r) => s + r, 0);
        const cx = Math.round(s0 + (five[0] ?? 0) + (five[1] ?? 0) + (five[2] ?? 0) / 2);
        const down = crossCheck(dark, w, h, cx, y, total);
        if (down && down.total > total * 0.6 && down.total < total * 1.6) addCenter(found, cx, down.y, (total + down.total) / 14);
      }
    }
  }
  return found.filter((c) => c.hits >= 2);
}

const dist = (a: FinderCenter, b: FinderCenter) => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * Boxes around every triple of finder centres that forms a QR code's corner: similar module sizes, two near-equal
 * sides with a hypotenuse about sqrt(2) times longer (allowing for perspective), and at least 10 modules apart (a
 * version-1 code's centres are 14 apart). Padded by 4 modules: 3.5 to the code's edge, plus a margin.
 */
export function groupCodes(centers: FinderCenter[], w: number, h: number): Box[] {
  const boxes: Box[] = [];
  const list = [...centers].sort((a, b) => b.hits - a.hits).slice(0, 40);
  for (let i = 0; i < list.length; i += 1) {
    for (let j = i + 1; j < list.length; j += 1) {
      for (let k = j + 1; k < list.length; k += 1) {
        const tri = [list[i], list[j], list[k]] as [FinderCenter, FinderCenter, FinderCenter];
        const modules = tri.map((c) => c.module);
        if (Math.max(...modules) > 1.6 * Math.min(...modules)) continue;
        const m = modules.reduce((s, v) => s + v, 0) / 3;
        const sides = [dist(tri[1], tri[2]), dist(tri[0], tri[2]), dist(tri[0], tri[1])];
        const hyp = Math.max(...sides);
        const corner = sides.indexOf(hyp);
        const legs = sides.filter((_, s) => s !== corner);
        const a = legs[0] ?? 0;
        const b = legs[1] ?? 0;
        if (Math.min(a, b) < 10 * m || Math.max(a, b) > 1.5 * Math.min(a, b)) continue;
        const ratio = hyp / ((a + b) / 2);
        if (ratio < 1.2 || ratio > 1.65) continue;
        const c = tri[corner] as FinderCenter;
        const others = tri.filter((_, s) => s !== corner);
        const fourth = { x: (others[0]?.x ?? 0) + (others[1]?.x ?? 0) - c.x, y: (others[0]?.y ?? 0) + (others[1]?.y ?? 0) - c.y };
        const xs = [...tri.map((t) => t.x), fourth.x];
        const ys = [...tri.map((t) => t.y), fourth.y];
        const pad = 4 * m;
        const box: Box = [Math.max(0, Math.min(...xs) - pad), Math.max(0, Math.min(...ys) - pad), Math.min(w, Math.max(...xs) + pad), Math.min(h, Math.max(...ys) + pad)];
        if (!boxes.some((q) => iou(q, box) > 0.5)) boxes.push(box);
      }
    }
  }
  return boxes;
}

/** QR-code boxes in a grey picture, decodable or not. */
export function findQrShapes(gray: Uint8Array | Uint8ClampedArray, w: number, h: number): Box[] {
  return groupCodes(findCenters(binarize(gray, w, h), w, h), w, h);
}
