// SPDX-License-Identifier: AGPL-3.0-only
// Adapted from Offleak (https://github.com/azharizz/offleak, commit 24e6a77), AGPL-3.0:
// FaceIds in app/offleak/detection/faces.py, and head_box, HeadDetector._pose_heads / detect / _vote in
// app/offleak/detection/heads.py.

import { area, at, clip, frontal, iou, xyxy, type Box, type FaceRow } from './geometry';
import { vote, type Vote } from './identity';
import type { HeadRow } from './redactor';

/**
 * Heads: people found by the pose model (including people seen from behind, whose face is not visible) merged with
 * the faces YuNet finds, as upstream's HeadDetector does. A face inside a pose head gives that head its identity
 * vote; a face with no pose head becomes a head of its own. Without the pose model (switched off, or it could not
 * load) every head is a detected face.
 */

export interface ScoredFace {
  row: FaceRow;
  /** SFace match against the chosen people, or null when the face was too small or not frontal to score. */
  score: number | null;
}

/** Only frontal faces of at least 24 px vote: a chosen person's profile scores like a stranger. */
export function shouldScore(face: FaceRow): boolean {
  return Math.min(at(face, 2), at(face, 3)) >= 24 && frontal(face);
}

/** Stable ids (from 200000, clear of any pose track ids) for faces, matched by IoU between passes. */
export class FaceIds {
  private tracks: Array<[number, Box]> = [];
  private nextId = 200000;

  assign(people: Array<[number, Box, Vote]>): void {
    const prev = [...this.tracks];
    this.tracks = [];
    for (const p of people) {
      if (p[0] !== -1) continue;
      let best: [number, Box] | null = null;
      for (const t of prev) if (!best || iou(t[1], p[1]) > iou(best[1], p[1])) best = t;
      if (best && iou(best[1], p[1]) > 0.3) {
        prev.splice(prev.indexOf(best), 1);
        p[0] = best[0];
      } else {
        p[0] = this.nextId;
        this.nextId += 1;
      }
      this.tracks.push([p[0], p[1]]);
    }
  }
}

/** A tracked person from the pose model: track id (-1 untracked) and head box. */
export interface PoseHead {
  tid: number;
  head: Box;
}

const ptp = (v: number[]) => (v.length ? Math.max(...v) - Math.min(...v) : 0);

/**
 * Head square from pose keypoints (nose, eyes, ears; 17 x [x, y, conf]); falls back to the top of the person box
 * for people seen from behind or occluded (upstream head_box).
 */
export function headBox(kp: ArrayLike<number>, box: Box): Box {
  const pts: Array<[number, number]> = [];
  for (let k = 0; k < 5; k += 1) if (at(kp, 3 * k + 2) > 0.3) pts.push([at(kp, 3 * k), at(kp, 3 * k + 1)]);
  if (pts.length >= 2) {
    const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
    const cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
    const sh: number[] = [];
    for (const k of [5, 6]) if (at(kp, 3 * k + 2) > 0.3) sh.push(at(kp, 3 * k));
    // ear-to-ear ~ head width; shoulder span ~ 2.2x head width
    const s = Math.max(ptp(pts.map((p) => p[0])) * 1.6, ptp(pts.map((p) => p[1])) * 2.5, sh.length === 2 ? ptp(sh) * 0.45 : 0, 16);
    return [cx - s * 0.55, cy - s * 0.65, cx + s * 0.55, cy + s * 0.55];
  }
  const [x1, y1, x2, y2] = box;
  const s = Math.max(16, Math.min((x2 - x1) * 0.6, (y2 - y1) * 0.35));
  const cx = (x1 + x2) / 2;
  return [cx - s / 2, y1, cx + s / 2, y1 + s];
}

/** Tracked pose heads, dropping duplicate boxes the pose model emits for close-ups (IoU > .5, keep the first). */
export function poseHeads(people: Array<{ head: Box }>, tids: number[]): PoseHead[] {
  const heads: PoseHead[] = [];
  people.forEach((p, i) => {
    if (!heads.some((q) => iou(p.head, q.head) > 0.5)) heads.push({ tid: tids[i] ?? -1, head: p.head });
  });
  return heads;
}

/**
 * One head pass (upstream HeadDetector.detect): faces overlapping a larger face (IoU >= .3) are dropped; each face,
 * largest first, is owned by the smallest free pose head that contains its centre and that it fills to >= 35%
 * (a small face inside a big close-up head belongs to someone behind); the owner grows to cover the face and takes
 * its vote. Faces with no owner become heads of their own. Ids, then boxes clipped to the frame.
 */
export function mergeHeads(pose: PoseHead[], faces: ScoredFace[], ids: FaceIds, w: number, h: number): HeadRow[] {
  const kept: ScoredFace[] = [];
  for (const f of [...faces].sort((a, b) => at(b.row, 2) * at(b.row, 3) - at(a.row, 2) * at(a.row, 3))) {
    if (kept.every((k) => iou(xyxy(k.row), xyxy(f.row)) < 0.3)) kept.push(f);
  }
  const people: Array<[number, Box, Vote]> = pose.map((p) => [p.tid, [...p.head] as Box, 0]);
  const owned = pose.length;
  const taken = new Set<number>();
  for (const f of kept) {
    const [x, y, fw, fh] = [at(f.row, 0), at(f.row, 1), at(f.row, 2), at(f.row, 3)];
    const cx = x + fw / 2;
    const cy = y + fh / 2;
    let owner = -1;
    for (let i = 0; i < owned; i += 1) {
      const b = (people[i] as [number, Box, Vote])[1];
      if (taken.has(i) || cx < b[0] || cx > b[2] || cy < b[1] || cy > b[3]) continue;
      if (Math.min(fw, fh) < 0.35 * Math.min(b[2] - b[0], b[3] - b[1])) continue;
      if (owner < 0 || area(b) < area((people[owner] as [number, Box, Vote])[1])) owner = i;
    }
    const size = Math.min(fw, fh);
    const v: Vote = f.score === null || !shouldScore(f.row) ? 0 : vote(f.score, size);
    if (owner >= 0) {
      taken.add(owner);
      const p = people[owner] as [number, Box, Vote];
      p[1] = [Math.min(p[1][0], x), Math.min(p[1][1], y), Math.max(p[1][2], x + fw), Math.max(p[1][3], y + fh)];
      p[2] = v;
    } else {
      people.push([-1, xyxy(f.row), v]);
    }
  }
  ids.assign(people);
  return people.map(([tid, b, v]) => {
    const [x1, y1, x2, y2] = clip(b, w, h);
    return [tid, x1, y1, x2, y2, v];
  });
}

/** One head pass from faces alone (pose switched off or unavailable). */
export function headsFromFaces(faces: ScoredFace[], ids: FaceIds, w: number, h: number): HeadRow[] {
  return mergeHeads([], faces, ids, w, h);
}
