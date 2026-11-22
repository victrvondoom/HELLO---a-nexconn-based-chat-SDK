// SPDX-License-Identifier: AGPL-3.0-only
// Adapted from Offleak (https://github.com/azharizz/offleak, commit 24e6a77), AGPL-3.0:
// app/offleak/config.py (thresholds), app/offleak/redaction/identity.py, FaceGallery.vote in detection/faces.py.

/**
 * Who stays visible. A face votes 1 (a person you chose), -1 (clearly a stranger) or 0 (unsure). Only the person's
 * chosen people are exempt from blurring; everyone else, and anyone unsure, is blurred.
 */

/** SFace cosine thresholds: chosen people scored .55-.89 and bystanders <= .30 on upstream's benchmark. */
export const MATCH = 0.45;
export const REJECT = 0.25;
/** Redactor timing in seconds, tuned upstream at live detector rates on held-out benchmark sets. */
export const HOLD = 0.8;
export const FACE_HOLD = 0.15;
export const KEEP = 1;

export type Vote = -1 | 0 | 1;

/** 1 = a chosen person, -1 = clearly a stranger (only trusted on faces >= 40 px), 0 = unsure. */
export function vote(score: number, size: number): Vote {
  if (score >= MATCH) return 1;
  return score < REJECT && size >= 40 ? -1 : 0;
}

/** Track id -> the frames where that track voted, and how. */
export type VoteEvents = Map<number, Array<[frame: number, vote: Vote]>>;

/**
 * Is this head a chosen person? A tracked head follows its nearest vote within `keep` frames (ties reject: fail
 * closed); an untracked head only has its own vote.
 */
export function exempt(events: VoteEvents, tid: number, frame: number, own: Vote, keep: number): boolean {
  if (tid < 0) return own === 1;
  let best: [number, Vote] | null = null;
  for (const [f, s] of events.get(tid) ?? []) {
    const d = Math.abs(frame - f);
    if (d > keep) continue;
    // min over (distance, vote): at equal distance the lower vote wins, so a tie with a stranger vote rejects.
    if (!best || d < best[0] || (d === best[0] && s < best[1])) best = [d, s];
  }
  return best !== null && best[1] === 1;
}

/** Cosine similarity of two embeddings (OpenCV FaceRecognizerSF_FR_COSINE). */
export function cosine(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  return dot / Math.max(1e-12, Math.sqrt(na) * Math.sqrt(nb));
}

/** Best match against the gallery; -1 when nobody was chosen (everyone is a stranger). */
export function galleryScore(gallery: ReadonlyArray<ArrayLike<number>>, feature: ArrayLike<number>): number {
  if (!gallery.length) return -1;
  return Math.max(...gallery.map((g) => cosine(g, feature)));
}
