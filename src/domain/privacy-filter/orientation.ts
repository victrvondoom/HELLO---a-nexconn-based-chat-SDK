// SPDX-License-Identifier: AGPL-3.0-only
// Adapted from Offleak (https://github.com/azharizz/offleak, commit 24e6a77, app/offleak/detection/orientation.py), AGPL-3.0.

/**
 * Which way is up, shared by the face and text lanes. A phone held sideways rotates the picture; a selfie camera
 * can mirror text. Both are estimated from evidence averaged over passes, so one noisy frame cannot flip the frame.
 */
export class Orientation {
  /** Quarter turns (clockwise) that make people upright. */
  rot = 0;
  /** Text reads mirrored. */
  mirror = false;
  private rolls: number[] = [];
  private mirrorEvidence = 0;

  /** Median face roll picks the upright quarter turn; two agreeing passes are needed to switch. */
  observeRolls(rolls: number[]): void {
    if (!rolls.length) return;
    const s = [...rolls].sort((a, b) => a - b);
    const mid = s.length >> 1;
    const m = s.length % 2 ? (s[mid] ?? 0) : ((s[mid - 1] ?? 0) + (s[mid] ?? 0)) / 2;
    const turn = ((Math.round(m / 90) % 4) + 4) % 4;
    const last = this.rolls[this.rolls.length - 1];
    this.rolls = [...this.rolls, turn].slice(-2);
    if (this.rolls.length === 2 && last === turn) this.rot = turn;
  }

  /** `evidence` > 0 means the flipped frame read better. Averaged: single frames flip-flop. */
  observeMirror(evidence: number): void {
    this.mirrorEvidence = 0.6 * this.mirrorEvidence + 0.4 * evidence;
    if (this.mirrorEvidence > 15) {
      this.mirror = !this.mirror;
      this.mirrorEvidence = 0;
    }
  }
}

/**
 * Which way is up without a platform face roll: every `every` face passes, the caller scores the four quarter turns
 * (best face confidence + match to a chosen person) and hands the scores here. Per-turn moving averages decide.
 */
export class UprightProbe {
  passes = 0;
  evidence: [number, number, number, number] = [0, 0, 0, 0];

  constructor(readonly every = 10) {}

  /** True when this pass should score the four turns. */
  due(): boolean {
    this.passes += 1;
    return this.passes % this.every === 0;
  }

  observe(scores: [number, number, number, number], orientation: Orientation): void {
    const current = orientation.rot;
    const base = scores[current % 4] ?? 0;
    this.evidence = this.evidence.map((e, k) => 0.7 * e + 0.3 * ((scores[k] ?? 0) - base)) as [number, number, number, number];
    let best = 0;
    for (let k = 1; k < 4; k += 1) if ((this.evidence[k] ?? 0) > (this.evidence[best] ?? 0)) best = k;
    if (best !== current && (this.evidence[best] ?? 0) > 0.04) {
      orientation.rot = best;
      this.evidence = [0, 0, 0, 0];
    }
  }
}

/** Mirror vote from one probe (upstream MirrorProbe): numbers count 100 each, plus the reading confidence. */
export function mirrorEvidence(flipped: { phones: number; textScore: number }, plain: { phones: number; textScore: number }): number {
  return 100 * flipped.phones + flipped.textScore - (100 * plain.phones + plain.textScore);
}
