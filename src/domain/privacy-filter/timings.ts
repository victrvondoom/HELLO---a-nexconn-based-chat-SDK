// SPDX-License-Identifier: AGPL-3.0-only
// Adapted from Offleak (https://github.com/azharizz/offleak, commit 24e6a77, app/offleak/instrumentation.py), AGPL-3.0.

/** Exponential moving averages of stage durations, shown next to the filter's live stats (`heads_ms`, `objects_ms`). */
export class Timings {
  private readonly ms = new Map<string, number>();

  constructor(private readonly alpha = 0.1) {}

  record(name: string, ms: number): void {
    const prev = this.ms.get(name);
    this.ms.set(name, prev === undefined ? ms : prev + this.alpha * (ms - prev));
  }

  snapshot(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [name, ms] of this.ms) out[`${name}_ms`] = Math.round(ms * 10) / 10;
    return out;
  }

  /** Time an async stage; records even when it throws (upstream `@timed`). */
  async time<T>(name: string, run: () => Promise<T>, clock: () => number = () => performance.now()): Promise<T> {
    const start = clock();
    try {
      return await run();
    } finally {
      this.record(name, clock() - start);
    }
  }
}
