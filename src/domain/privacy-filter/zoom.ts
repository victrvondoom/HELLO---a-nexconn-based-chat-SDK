// SPDX-License-Identifier: AGPL-3.0-only
// Adapted from Offleak (https://github.com/azharizz/offleak, commit 24e6a77, app/offleak/detection/objects.py
// CropZoom and SCREENS), AGPL-3.0.
import type { Box } from './geometry';

/**
 * Crop zoom: small text and codes on a screen, a phone or a sheet of paper are unreadable at frame scale. The screen
 * detector (YOLO11n) finds those regions; each is cropped with a 10% margin and enlarged up to 3x (to at most 960 px)
 * before the QR and phone-number readers run on it again. Boxes found in a crop are mapped back to the frame.
 */

/** COCO classes: tv, laptop, cell phone, book (paper). */
export const SCREEN_CLASSES = [62, 63, 67, 73] as const;
export const SCREEN_CONF = 0.25;

export interface ZoomRegion {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** Enlargement applied to the crop (1 = none). */
  s: number;
}

/** Screen boxes -> padded crops in frame pixels with their zoom; crops under 32 px are skipped. */
export function zoomRegions(boxes: Box[], gw: number, gh: number): ZoomRegion[] {
  const out: ZoomRegion[] = [];
  for (const b of boxes) {
    const px = (b[2] - b[0]) * 0.1;
    const py = (b[3] - b[1]) * 0.1;
    const x1 = Math.trunc(Math.max(0, b[0] - px));
    const y1 = Math.trunc(Math.max(0, b[1] - py));
    const x2 = Math.trunc(Math.min(gw, b[2] + px));
    const y2 = Math.trunc(Math.min(gh, b[3] + py));
    if (Math.min(x2 - x1, y2 - y1) < 32) continue;
    let s = Math.min(3, 960 / Math.max(x2 - x1, y2 - y1));
    if (s <= 1.2) s = 1;
    out.push({ x1, y1, x2, y2, s });
  }
  return out;
}

/** A box found on the enlarged crop -> the same box in the frame. */
export function fromZoom(box: Box, r: ZoomRegion): Box {
  return [Math.trunc(r.x1 + box[0] / r.s), Math.trunc(r.y1 + box[1] / r.s), Math.trunc(r.x1 + box[2] / r.s) + 1, Math.trunc(r.y1 + box[3] / r.s) + 1];
}
