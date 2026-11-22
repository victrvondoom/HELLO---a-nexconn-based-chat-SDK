/**
 * OFFLINE EVALUATOR ONLY. The true set M(w) of minimal failing disruption sets for a world and schedule.
 *
 * Agent-facing code (search, Critic, proposer, services, routes) must never import this file; it exists to
 * measure them. tests/unit/resilience-isolation.test.ts enforces that nothing under src/ imports it.
 */
import { simulate } from '@/domain/resilience/simulator';
import { SUBSET_COUNT, type Schedule, type World } from '@/domain/resilience/world';

export function minimalFailingSets(world: World, schedule: Schedule): number[] {
  const fails = Array.from({ length: SUBSET_COUNT }, (_, mask) => !simulate(world, schedule, mask).pass);
  const minimal: number[] = [];
  for (let mask = 0; mask < SUBSET_COUNT; mask += 1) {
    if (!fails[mask]) continue;
    // Minimal: no proper subset fails. Checked over every proper subset, so it holds without monotonicity.
    let proper = false;
    if (mask !== 0) for (let sub = (mask - 1) & mask; ; sub = (sub - 1) & mask) {
      if (fails[sub]) {
        proper = true;
        break;
      }
      if (sub === 0) break;
    }
    if (!proper) minimal.push(mask);
  }
  return minimal;
}

export function recallAt(found: number[], truth: number[]): number {
  if (truth.length === 0) return 1;
  const set = new Set(found);
  return truth.filter((m) => set.has(m)).length / truth.length;
}

/** A false-robust run: failures exist, the budget was spent, and none of the true minimal sets was found. */
export function falseRobust(found: number[], truth: number[]): boolean {
  return truth.length > 0 && recallAt(found, truth) === 0;
}
