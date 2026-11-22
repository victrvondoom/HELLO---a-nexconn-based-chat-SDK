import { iou, type Box } from './geometry';

/**
 * Stable ids for people found by the pose model, across detection passes (written for HELLO; no Offleak code).
 *
 * The association follows ByteTrack's two stages, with the thresholds of Ultralytics' `bytetrack.yaml` that
 * upstream Offleak tracks with: confident detections (>= .25) are matched to tracks first, then weak ones (>= .1)
 * to the tracks still unmatched; only confident detections start a track; a lost track is kept for 30 passes.
 * Differences, stated plainly: matching is greedy by IoU rather than the Hungarian method, and motion is a
 * smoothed constant velocity rather than a Kalman filter.
 *
 * Unlike Ultralytics, a detection that no track claims is still returned (with id -1) on the pass it appears:
 * hiding a new person until a second pass confirms them would leave them unblurred for that pass.
 */

export interface TrackInput {
  box: Box;
  score: number;
}

interface Track {
  id: number;
  box: Box;
  /** Smoothed per-pass motion of each box edge. */
  v: Box;
  lost: number;
}

export const TRACK_HIGH = 0.25;
export const TRACK_LOW = 0.1;
export const TRACK_BUFFER = 30;
/** ByteTrack's match_thresh .8 is a cost (1 - IoU): a pair must overlap by IoU >= .2. */
export const TRACK_MIN_IOU = 0.2;

const shift = (a: Box, b: Box): Box => [a[0] + b[0], a[1] + b[1], a[2] + b[2], a[3] + b[3]];

export class PeopleTracker {
  private tracks: Track[] = [];
  private nextId = 1;

  /** Ids for this pass's detections, in input order (-1: not tracked). */
  update(dets: TrackInput[]): number[] {
    const ids = dets.map(() => -1);
    const predicted = this.tracks.map((t) => shift(t.box, t.v));
    const free = new Set(this.tracks.map((_, i) => i));
    const match = (which: number[]): Set<number> => {
      const pairs: Array<[number, number, number]> = [];
      for (const d of which) {
        for (const t of free) {
          const o = iou(predicted[t] as Box, (dets[d] as TrackInput).box);
          if (o >= TRACK_MIN_IOU) pairs.push([o, t, d]);
        }
      }
      pairs.sort((a, b) => b[0] - a[0]);
      const used = new Set<number>();
      for (const [, t, d] of pairs) {
        if (!free.has(t) || used.has(d)) continue;
        free.delete(t);
        used.add(d);
        const track = this.tracks[t] as Track;
        const box = (dets[d] as TrackInput).box;
        track.v = track.v.map((v, i) => 0.5 * v + 0.5 * ((box[i] ?? 0) - (track.box[i] ?? 0))) as Box;
        track.box = box;
        track.lost = 0;
        ids[d] = track.id;
      }
      return used;
    };
    const high = dets.flatMap((d, i) => (d.score >= TRACK_HIGH ? [i] : []));
    const low = dets.flatMap((d, i) => (d.score >= TRACK_LOW && d.score < TRACK_HIGH ? [i] : []));
    const usedHigh = match(high);
    match(low);
    for (const t of free) {
      const track = this.tracks[t] as Track;
      track.lost += 1;
      track.box = shift(track.box, track.v);
    }
    for (const d of high) {
      if (usedHigh.has(d)) continue;
      const track: Track = { id: this.nextId, box: (dets[d] as TrackInput).box, v: [0, 0, 0, 0], lost: 0 };
      this.nextId += 1;
      this.tracks.push(track);
      ids[d] = track.id;
    }
    this.tracks = this.tracks.filter((t) => t.lost <= TRACK_BUFFER);
    return ids;
  }

  get size(): number {
    return this.tracks.length;
  }
}
