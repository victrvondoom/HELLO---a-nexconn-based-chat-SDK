// SPDX-License-Identifier: AGPL-3.0-only
// Adapted from Offleak (https://github.com/azharizz/offleak, commit 24e6a77, app/offleak/redaction/blur.py), AGPL-3.0.
// The 'blur' and 'blackout' effects were added for HELLO.
import type { MaskPlan } from '@/domain/privacy-filter/redactor';
import type { RedactionEffect } from '@/domain/privacy-filter/settings';

type Canvas2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

const ctx2d = (c: OffscreenCanvas) => c.getContext('2d') as OffscreenCanvasRenderingContext2D;

/**
 * Draws a frame with its mask plan applied. The plan's rectangles are replayed onto a mask (fill, then clear for a
 * chosen person, then fill again); a full plan hides the whole frame (fail closed). Effects:
 *
 * - `pixelate` (upstream PixelateBlur): 1/16 downscale + Gaussian (sigma 1.5) + bilinear upscale. Unreadable QR
 *   codes and digits, still looks like video.
 * - `blur`: 1/8 downscale + a Gaussian of 1/60 of the frame's long side, upscaled. Softer to look at; without
 *   canvas filter support it is still a 1/8 pixelation.
 * - `blackout`: solid black. Nothing of the original survives.
 */
export class MaskRenderer {
  private readonly small: OffscreenCanvas;
  private readonly soft: OffscreenCanvas;
  private readonly layer: OffscreenCanvas;
  private readonly mask: OffscreenCanvas;
  private readonly sigma: number;

  constructor(
    readonly w: number,
    readonly h: number,
    readonly effect: RedactionEffect = 'pixelate',
  ) {
    const factor = effect === 'blur' ? 8 : 16;
    const sw = Math.max(1, Math.floor(w / factor));
    const sh = Math.max(1, Math.floor(h / factor));
    this.sigma = effect === 'blur' ? Math.max(1.5, Math.max(w, h) / 60 / factor) : 1.5;
    this.small = new OffscreenCanvas(sw, sh);
    this.soft = new OffscreenCanvas(sw, sh);
    this.layer = new OffscreenCanvas(Math.max(1, w), Math.max(1, h));
    this.mask = new OffscreenCanvas(Math.max(1, w), Math.max(1, h));
  }

  private hidden(frame: CanvasImageSource): OffscreenCanvas {
    const l = ctx2d(this.layer);
    l.globalCompositeOperation = 'source-over';
    l.clearRect(0, 0, this.w, this.h);
    if (this.effect === 'blackout') {
      l.fillStyle = '#000';
      l.fillRect(0, 0, this.w, this.h);
      return this.layer;
    }
    const s = ctx2d(this.small);
    s.imageSmoothingEnabled = true;
    s.drawImage(frame, 0, 0, this.small.width, this.small.height);
    const b = ctx2d(this.soft);
    b.clearRect(0, 0, this.soft.width, this.soft.height);
    b.filter = `blur(${String(this.sigma)}px)`;
    b.drawImage(this.small, 0, 0);
    b.filter = 'none';
    l.imageSmoothingEnabled = true;
    l.drawImage(this.soft, 0, 0, this.w, this.h);
    return this.layer;
  }

  /** Draws `frame` into `out` with the plan applied. Returns true when anything was hidden. */
  draw(out: Canvas2D, frame: CanvasImageSource, plan: MaskPlan): boolean {
    out.globalCompositeOperation = 'source-over';
    out.drawImage(frame, 0, 0, this.w, this.h);
    if (plan.full) {
      out.drawImage(this.hidden(frame), 0, 0);
      return true;
    }
    if (!plan.ops.some((op) => op.add)) return false;
    const m = ctx2d(this.mask);
    m.globalCompositeOperation = 'source-over';
    m.clearRect(0, 0, this.w, this.h);
    m.fillStyle = '#fff';
    for (const op of plan.ops) {
      const [x1, y1, x2, y2] = op.box;
      // inclusive pixel rectangles, as cv2.rectangle fills them
      if (op.add) m.fillRect(x1, y1, x2 - x1 + 1, y2 - y1 + 1);
      else m.clearRect(x1, y1, x2 - x1 + 1, y2 - y1 + 1);
    }
    const layer = this.hidden(frame);
    const l = ctx2d(layer);
    l.globalCompositeOperation = 'destination-in';
    l.drawImage(this.mask, 0, 0);
    l.globalCompositeOperation = 'source-over';
    out.drawImage(layer, 0, 0);
    return true;
  }
}
