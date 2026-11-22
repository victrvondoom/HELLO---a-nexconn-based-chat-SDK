import { describe, expect, it } from 'vitest';
import { fingerprint } from '@/domain/ops/bench';
import { runReliabilityLab } from '@/services/ops/reliability-lab';

/** Run with: npx vitest run tests/reliability/lab.test.ts  (prints the table recorded in docs/HELLO_OPS_NETWORK.md) */
describe('Reliability Lab', () => {
  it('runs all 12 categories with no failures, and is reproducible for a seed', async () => {
    const a = await runReliabilityLab({ seed: 1 });
    const b = await runReliabilityLab({ seed: 1 });
    expect(a.reports).toHaveLength(12);
    expect(fingerprint(a)).toBe(fingerprint(b));
    console.log(['| Benchmark | Scenarios | Passed | Failed | Rejected safely | FP | FN | p50 ms | p95 ms | p99 ms | Runtime ms |', '|---|---|---|---|---|---|---|---|---|---|---|', ...a.reports.map((r) => `| ${r.id} | ${r.scenarios} | ${r.passed} | ${r.failed} | ${r.rejectedSafely} | ${r.falsePositives ?? '—'} | ${r.falseNegatives ?? '—'} | ${r.latencyMs.p50} | ${r.latencyMs.p95} | ${r.latencyMs.p99} | ${r.runtimeMs} |`)].join('\n'));
    for (const r of a.reports) expect(r.failures, r.id).toEqual([]);
  }, 120_000);
});
