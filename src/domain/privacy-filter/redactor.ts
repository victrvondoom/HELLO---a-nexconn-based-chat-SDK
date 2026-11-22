// SPDX-License-Identifier: AGPL-3.0-only
// Adapted from Offleak (https://github.com/azharizz/offleak, commit 24e6a77, app/offleak/redaction/redactor.py), AGPL-3.0.

import { padBox, type Box } from './geometry';
import { FACE_HOLD, HOLD, KEEP, exempt, type Vote, type VoteEvents } from './identity';
import { move } from './flow';

/**
 * The delay-buffered redaction engine shared by the live call filter and the photo filter.
 *
 * add() frames; attach detections with putHeads / putObjects (any frame, any order); emit() returns the oldest
 * frame with its mask plan once `delay` seconds of lookahead exist. Fails closed: a frame with no result from a
 * switched-on detector within one second either side is blurred whole.
 *
 * Upstream draws the mask into a pixel array. Here the mask is a plan: ordered rectangle operations that a canvas
 * replays (fill, then clear for a chosen person, then fill again for this frame's strangers, then QR and phone
 * boxes on top). Rectangles are inclusive pixel coordinates, as cv2.rectangle draws them.
 */

/** [trackId, x1, y1, x2, y2, vote]. trackId < 0 means untracked. */
export type HeadRow = [number, number, number, number, number, Vote];

export interface MaskOp {
  add: boolean;
  box: Box;
}

export interface MaskPlan {
  /** Blur everything: a detector stalled. */
  full: boolean;
  ops: MaskOp[];
}

export interface Emitted<T> {
  index: number;
  frame: T;
  plan: MaskPlan;
}

export interface RedactorOptions {
  delay?: number;
  hold?: number;
  faceHold?: number;
  keep?: number;
  faceEnabled?: boolean;
  objectsEnabled?: boolean;
}

export class Redactor<T> {
  readonly D: number;
  readonly hold: number;
  readonly fhold: number;
  readonly keep: number;
  readonly faceEnabled: boolean;
  readonly objectsEnabled: boolean;
  n = 0;
  out = 0;
  /** Detections that arrived after their frame was emitted. */
  late = 0;
  /** Frames blurred whole because a detector had no result within one second. */
  failsafe = 0;
  /** Chosen-person boxes left visible in the last emitted frame (debug overlay). */
  lastKeep: Box[] = [];

  private readonly frames = new Map<number, T>();
  private readonly disp = new Map<number, Float32Array>();
  private readonly obj = new Map<number, Box[]>();
  /** Boxes from helper passes (crop zoom): blurred like objects, but never counted as the objects lane reporting. */
  private readonly extra = new Map<number, Box[]>();
  private readonly head = new Map<number, HeadRow[]>();
  private readonly events: VoteEvents = new Map();
  private boxCache = new Map<string, { at: number; box: Box; from: number }>();

  constructor(
    readonly fps: number,
    readonly w: number,
    readonly h: number,
    /** Grid points the displacements refer to (GridFlow.pts). */
    private readonly pts: Float32Array,
    options: RedactorOptions = {},
  ) {
    this.faceEnabled = options.faceEnabled ?? true;
    this.objectsEnabled = options.objectsEnabled ?? true;
    this.D = Math.round((options.delay ?? 1) * fps);
    this.hold = Math.round((options.hold ?? HOLD) * fps);
    this.fhold = Math.round((options.faceHold ?? FACE_HOLD) * fps);
    this.keep = Math.round((options.keep ?? KEEP) * fps);
  }

  /** Adds a frame and the flow displacement from the previous frame to it. Returns the frame index. */
  add(frame: T, disp: Float32Array): number {
    const i = this.n;
    this.frames.set(i, frame);
    this.disp.set(i, disp);
    this.n += 1;
    return i;
  }

  putHeads(i: number, heads: HeadRow[]): void {
    if (i < this.out) this.late += 1;
    this.head.set(i, heads);
    for (const [tid, , , , , v] of heads) {
      if (tid >= 0 && v) {
        const list = this.events.get(tid) ?? [];
        list.push([i, v]);
        this.events.set(tid, list);
      }
    }
  }

  putObjects(i: number, qr: Box[], phone: Box[]): void {
    if (i < this.out) this.late += 1;
    this.obj.set(i, [...qr, ...phone]);
  }

  /**
   * Extra QR / phone boxes for frame i from a slower helper pass (crop zoom). They are blurred with the same hold,
   * but do not satisfy the fail-safe: only the objects lane's own result shows that frame i was checked.
   */
  addExtra(i: number, boxes: Box[]): void {
    if (i < this.out) this.late += 1;
    this.extra.set(i, [...(this.extra.get(i) ?? []), ...boxes]);
  }

  ready(flush = false): boolean {
    return this.out < this.n && (flush || this.out <= this.n - 1 - this.D);
  }

  /** Frames waiting to be emitted. */
  get buffered(): number {
    return this.n - this.out;
  }

  /** Box detected on frame j, moved by optical flow to frame i (either direction). */
  carry(box: Box, j: number, i: number): Box {
    const key = `${j}:${box.join(',')}`;
    const cached = this.boxCache.get(key);
    const round = (b: Box): Box => [Math.round(b[0]), Math.round(b[1]), Math.round(b[2]), Math.round(b[3])];
    if (cached && cached.at === i) return round(cached.box);
    let moved: Box;
    const zero = new Float32Array(this.pts.length);
    if (cached && cached.at === i - 1 && j < i) {
      moved = move(cached.box, this.disp.get(i) ?? zero, this.pts, 1);
    } else {
      moved = [box[0], box[1], box[2], box[3]];
      for (let k = j + 1; k <= i; k += 1) moved = move(moved, this.disp.get(k) ?? zero, this.pts, 1);
      for (let k = j; k > i; k -= 1) moved = move(moved, this.disp.get(k) ?? zero, this.pts, -1);
    }
    if (j <= i) this.boxCache.set(key, { at: i, box: moved, from: j });
    return round(moved);
  }

  mask(i: number): MaskPlan {
    const window = Math.round(this.fps);
    const lo = Math.max(0, i - window);
    const hi = Math.min(this.n, i + window + 1);
    const keys: number[] = [];
    let anyObj = false;
    for (let j = lo; j < hi; j += 1) {
      if (this.head.has(j)) keys.push(j);
      if (this.obj.has(j)) anyObj = true;
    }
    if ((this.faceEnabled && !keys.length) || (this.objectsEnabled && !anyObj)) {
      this.failsafe += 1; // a detector stalled: blur everything rather than show unchecked pixels
      this.lastKeep = [];
      return { full: true, ops: [] };
    }
    const fill = (b: Box, frac: number, minpad: number): MaskOp => ({ add: true, box: padBox(b, frac, minpad, this.w, this.h) });
    const faceOps: MaskOp[] = [];
    const objOps: MaskOp[] = [];
    for (let j = Math.max(0, i - this.hold); j < Math.min(this.n, i + this.hold + 1); j += 1) {
      for (const b of this.obj.get(j) ?? []) objOps.push(fill(this.carry(b, j, i), 0.15, 6));
      for (const b of this.extra.get(j) ?? []) objOps.push(fill(this.carry(b, j, i), 0.15, 6));
    }
    this.lastKeep = [];
    if (keys.length) {
      // nearest detection; at equal distance the earlier one
      const near = keys.reduce((best, j) => {
        const dj = Math.abs(j - i);
        const db = Math.abs(best - i);
        return dj < db || (dj === db && j <= i && best > i) ? j : best;
      });
      const rows = new Set<number>(keys.filter((j) => Math.abs(j - i) <= this.fhold));
      rows.add(near);
      const before = keys.filter((j) => j <= i);
      const after = keys.filter((j) => j > i);
      rows.add(before.length ? Math.max(...before) : near);
      rows.add(after.length ? Math.min(...after) : near);
      for (const j of [...rows].sort((a, b) => a - b)) {
        for (const [tid, x1, y1, x2, y2, v] of this.head.get(j) ?? []) {
          if (!exempt(this.events, tid, j, v, this.keep)) faceOps.push(fill(this.carry([x1, y1, x2, y2], j, i), 0.1, 4));
        }
      }
      const current = (this.head.get(near) ?? []).map(([tid, x1, y1, x2, y2, v]) => ({ box: this.carry([x1, y1, x2, y2], near, i), ok: exempt(this.events, tid, near, v, this.keep) }));
      this.lastKeep = current.filter((c) => c.ok).map((c) => c.box);
      // Clear the chosen person's head (held stranger masks may spill onto it), then re-blur this frame's strangers.
      // Known limit (upstream too): clearing can reveal an undetected face inside a chosen person's box.
      for (const c of current) if (c.ok) faceOps.push({ add: false, box: c.box });
      for (const c of current) if (!c.ok) faceOps.push(fill(c.box, 0.1, 4));
    }
    return { full: false, ops: [...faceOps, ...objOps] };
  }

  /** Rectangles that must be hidden on every frame whatever the detectors say (manual regions), added after the plan. */
  static withManual(plan: MaskPlan, manual: readonly Box[]): MaskPlan {
    if (plan.full || !manual.length) return plan;
    return { full: false, ops: [...plan.ops, ...manual.map((box) => ({ add: true, box: [...box] as Box }))] };
  }

  emit(): Emitted<T> {
    const i = this.out;
    const plan = this.mask(i);
    const frame = this.frames.get(i) as T;
    this.frames.delete(i);
    this.out += 1;
    const old = i - Math.max(Math.round(1.5 * this.fps), this.hold + 1);
    for (const [key, value] of this.boxCache) if (value.from < old) this.boxCache.delete(key);
    for (const map of [this.disp, this.obj, this.extra, this.head] as Array<Map<number, unknown>>) {
      for (const k of [...map.keys()]) if (k < old) map.delete(k);
    }
    if (i % 300 === 0) {
      // drop expired votes, and tracks with none left (stranger ids pile up over long calls)
      for (const [tid, list] of this.events) {
        const kept = list.filter(([f]) => f >= old - this.keep);
        if (kept.length) this.events.set(tid, kept);
        else this.events.delete(tid);
      }
    }
    return { index: i, frame, plan };
  }

  /** Track ids that still hold votes (tests and stats). */
  get trackedIds(): number[] {
    return [...this.events.keys()];
  }
}
