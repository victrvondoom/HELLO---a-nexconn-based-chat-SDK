import { simulate, type SimResult } from './simulator';
import { DISRUPTIONS, FULL_MASK, SUBSET_COUNT, popcount, rng, type Schedule, type World } from './world';

/**
 * Failure discovery under a simulator-query budget.
 *
 * Every algorithm here asks the simulator through an `Oracle`, which counts each distinct (world, schedule,
 * mask) query once. A repeated identical query is served from the cache and costs nothing, as the benchmark
 * defines. None of this code knows the true set of minimal failing sets: that lives only in the offline
 * evaluator (tests/resilience/groundtruth.ts), and a static test keeps it that way.
 */

export class BudgetExhausted extends Error {
  constructor() {
    super('Simulator query budget exhausted.');
  }
}

export class Oracle {
  private readonly cache = new Map<number, SimResult>();
  queries = 0;

  constructor(
    readonly world: World,
    readonly schedule: Schedule,
    readonly budget: number = Number.POSITIVE_INFINITY,
  ) {}

  /** True if this mask was already simulated (free to ask again). */
  known(mask: number): boolean {
    return this.cache.has(mask);
  }

  run(mask: number): SimResult {
    const hit = this.cache.get(mask);
    if (hit) return hit;
    if (this.queries >= this.budget) throw new BudgetExhausted();
    this.queries += 1;
    const result = simulate(this.world, this.schedule, mask);
    this.cache.set(mask, result);
    return result;
  }

  fails(mask: number): boolean {
    return !this.run(mask).pass;
  }

  /** The smallest margin across every constraint: lower is closer to failure. */
  worstMargin(mask: number): number {
    return Math.min(...Object.values(this.run(mask).margins));
  }
}

export type Algorithm = 'random' | 'greedy' | 'cardinality' | 'monotone';

export interface SearchResult {
  algorithm: Algorithm;
  /** Failing sets the algorithm believes are minimal. */
  found: number[];
  queries: number;
  exhausted: boolean;
  /** Monotonicity pruning was used only with a valid certificate for this exact world and schedule. */
  pruning: 'monotone' | 'disabled';
}

const isSubset = (a: number, b: number) => (a & b) === a;

/** Shrinks a failing set by removing one disruption at a time while it still fails (1-minimal). */
function shrink(oracle: Oracle, mask: number): number {
  let current = mask;
  for (let i = 0; i < DISRUPTIONS.length; i += 1) {
    const bit = 1 << i;
    if ((current & bit) === 0) continue;
    const smaller = current & ~bit;
    if (oracle.fails(smaller)) current = smaller;
  }
  return current;
}

function addFound(found: number[], mask: number) {
  if (found.some((f) => isSubset(f, mask))) return;
  for (let i = found.length - 1; i >= 0; i -= 1) if (isSubset(mask, found[i] as number)) found.splice(i, 1);
  found.push(mask);
}

function guard(oracle: Oracle, body: () => void): boolean {
  try {
    body();
    return false;
  } catch (e) {
    if (e instanceof BudgetExhausted) return true;
    throw e;
  }
}

/** Uniform random subsets, each failure shrunk. A baseline that only luck makes good. */
export function randomSearch(oracle: Oracle, seed = 1): SearchResult {
  const found: number[] = [];
  const next = rng(seed);
  const exhausted = guard(oracle, () => {
    for (let tries = 0; tries < SUBSET_COUNT * 4; tries += 1) {
      const mask = Math.floor(next() * SUBSET_COUNT);
      if (oracle.known(mask) || found.some((f) => isSubset(f, mask))) continue;
      if (oracle.fails(mask)) addFound(found, shrink(oracle, mask));
    }
  });
  return { algorithm: 'random', found, queries: oracle.queries, exhausted, pruning: 'disabled' };
}

/** From each single disruption, keep adding the disruption that lowers the worst margin most, until failure. */
export function greedySearch(oracle: Oracle): SearchResult {
  const found: number[] = [];
  const exhausted = guard(oracle, () => {
    for (let start = 0; start < DISRUPTIONS.length; start += 1) {
      let mask = 1 << start;
      while (!oracle.fails(mask) && mask !== FULL_MASK) {
        let best = -1;
        let bestMargin = Number.POSITIVE_INFINITY;
        for (let i = 0; i < DISRUPTIONS.length; i += 1) {
          if (mask & (1 << i)) continue;
          const m = oracle.worstMargin(mask | (1 << i));
          if (m < bestMargin) {
            bestMargin = m;
            best = i;
          }
        }
        mask |= 1 << best;
      }
      if (oracle.fails(mask)) addFound(found, shrink(oracle, mask));
    }
  });
  return { algorithm: 'greedy', found, queries: oracle.queries, exhausted, pruning: 'disabled' };
}

/** All masks ordered by size then value: the lattice, bottom-up. */
export const BY_SIZE: readonly number[] = Array.from({ length: SUBSET_COUNT }, (_, m) => m).sort((a, b) => popcount(a) - popcount(b) || a - b);

/**
 * Minimal-set enumeration: walk the lattice bottom-up and skip every superset of a set already found to fail
 * (a superset of a failing set is never minimal, whatever the world). Exact when the budget allows: a set it
 * tests has had every proper subset tested first and found passing.
 */
export function cardinalitySearch(oracle: Oracle): SearchResult {
  const found: number[] = [];
  const exhausted = guard(oracle, () => {
    for (const mask of BY_SIZE) {
      if (found.some((f) => isSubset(f, mask))) continue;
      if (oracle.fails(mask)) found.push(mask);
    }
  });
  return { algorithm: 'cardinality', found, queries: oracle.queries, exhausted, pruning: 'disabled' };
}

/**
 * Monotonicity-aware search. Only valid when the world and schedule carry a monotonicity certificate: then a
 * passing set implies every subset passes, so one passing query can retire many sets. Without a certificate
 * it falls back to `cardinalitySearch` and says so: it never prunes on an unproven assumption.
 */
export function monotoneSearch(oracle: Oracle, certified: boolean): SearchResult {
  if (!certified) return { ...cardinalitySearch(oracle), algorithm: 'monotone', pruning: 'disabled' };
  const found: number[] = [];
  const passing: number[] = [];
  const exhausted = guard(oracle, () => {
    // Top-down first: if everything at once passes, nothing fails.
    if (!oracle.fails(FULL_MASK)) return;
    // Each complement of one disruption: a pass retires half the lattice.
    for (let i = 0; i < DISRUPTIONS.length; i += 1) {
      const mask = FULL_MASK & ~(1 << i);
      if (!oracle.fails(mask)) passing.push(mask);
    }
    for (const mask of BY_SIZE) {
      if (found.some((f) => isSubset(f, mask))) continue;
      if (passing.some((p) => isSubset(mask, p))) continue;
      if (oracle.fails(mask)) found.push(mask);
      else passing.push(mask);
    }
  });
  return { algorithm: 'monotone', found, queries: oracle.queries, exhausted, pruning: 'monotone' };
}

export function runSearch(algorithm: Algorithm, world: World, schedule: Schedule, budget: number, options: { seed?: number; monotoneCertified?: boolean } = {}): SearchResult {
  const oracle = new Oracle(world, schedule, budget);
  switch (algorithm) {
    case 'random':
      return randomSearch(oracle, options.seed ?? 1);
    case 'greedy':
      return greedySearch(oracle);
    case 'cardinality':
      return cardinalitySearch(oracle);
    case 'monotone':
      return monotoneSearch(oracle, options.monotoneCertified === true);
  }
}
