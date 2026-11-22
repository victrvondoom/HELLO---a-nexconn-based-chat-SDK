import { describe, expect, it } from 'vitest';
import { runSearch, type Algorithm } from '@/domain/resilience/search';
import { checkMonotone } from '@/domain/resilience/verify';
import { benchmarkWorldV1, seededWorld } from '@/domain/resilience/world';
import { falseRobust, minimalFailingSets, recallAt } from './groundtruth';

/**
 * Offline benchmark: Minimal Failure Recall@B and false-robust runs for each search algorithm, across the
 * v1 world and 40 seeded variations (41 worlds). Ground truth comes only from the offline evaluator.
 * Run `npx vitest run tests/resilience/benchmark.test.ts` to print the table recorded in docs/HELLO_STEADFAST.md.
 */
const WORLDS = [benchmarkWorldV1(), ...Array.from({ length: 40 }, (_, i) => seededWorld(i + 1))];
const ALGORITHMS: Algorithm[] = ['random', 'greedy', 'cardinality', 'monotone'];
const BUDGETS = [16, 32, 64, 256];

describe('Steadfast benchmark (41 worlds)', () => {
  const truth = WORLDS.map(({ world, baseline }) => minimalFailingSets(world, baseline));
  const certified = WORLDS.map(({ world, baseline }) => checkMonotone(world, baseline).monotone);

  it('measures every algorithm at every budget', () => {
    const rows: string[] = [];
    for (const algorithm of ALGORITHMS) {
      for (const budget of BUDGETS) {
        let recall = 0;
        let falseRobustRuns = 0;
        let queries = 0;
        const started = performance.now();
        WORLDS.forEach(({ world, baseline }, i) => {
          const result = runSearch(algorithm, world, baseline, budget, { seed: i + 1, monotoneCertified: certified[i] });
          const t = truth[i] ?? [];
          recall += recallAt(result.found, t);
          if (falseRobust(result.found, t)) falseRobustRuns += 1;
          queries += result.queries;
        });
        const ms = performance.now() - started;
        rows.push(`| ${algorithm} | ${budget} | ${(recall / WORLDS.length).toFixed(3)} | ${falseRobustRuns} | ${(queries / WORLDS.length).toFixed(1)} | ${ms.toFixed(0)} |`);
      }
    }
    console.log(['| Algorithm | Budget B | Mean Recall@B | False-robust runs | Mean queries | Wall ms (41 worlds) |', '|---|---|---|---|---|---|', ...rows].join('\n'));
    console.log(`Monotone worlds: ${certified.filter(Boolean).length} of ${WORLDS.length}. Worlds with at least one failure: ${truth.filter((t) => t.length > 0).length}.`);
  });

  it('minimal-set enumeration is exact with the full budget, in every world', () => {
    WORLDS.forEach(({ world, baseline }, i) => {
      const result = runSearch('cardinality', world, baseline, 256);
      expect(new Set(result.found)).toEqual(new Set(truth[i]));
    });
  });

  it('monotone pruning is exact, and never used without a certificate', () => {
    WORLDS.forEach(({ world, baseline }, i) => {
      const result = runSearch('monotone', world, baseline, 256, { monotoneCertified: certified[i] });
      expect(result.pruning).toBe(certified[i] ? 'monotone' : 'disabled');
      expect(new Set(result.found)).toEqual(new Set(truth[i]));
    });
  });
});
