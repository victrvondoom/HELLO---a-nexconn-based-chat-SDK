import { simulate, type ConstraintFamily } from './simulator';
import { DISRUPTIONS, SUBSET_COUNT, digest, idsOf, type DisruptionId, type Schedule, type World } from './world';

/**
 * Exact verification and monotonicity certificates. Both enumerate every one of the 256 disruption subsets of
 * the bounded world against one exact schedule version. Nothing is sampled, so the word "exact" is earned.
 */

export interface Certificate {
  kind: 'EXACT';
  worldId: string;
  worldVersion: string;
  scheduleVersion: string;
  subsetsChecked: number;
  simulatorQueries: number;
  allPass: boolean;
  failing: Array<{ mask: number; disruptions: DisruptionId[]; constraints: ConstraintFamily[] }>;
  /** A digest over every subset's outcome: two certificates agree only if every result agrees. */
  digest: string;
}

export function verifyExact(world: World, schedule: Schedule): Certificate {
  const failing: Certificate['failing'] = [];
  const outcomes: string[] = [];
  for (let mask = 0; mask < SUBSET_COUNT; mask += 1) {
    const result = simulate(world, schedule, mask);
    outcomes.push(result.pass ? '1' : '0');
    if (!result.pass) failing.push({ mask, disruptions: idsOf(mask), constraints: [...new Set(result.violations.map((v) => v.constraint))] });
  }
  return {
    kind: 'EXACT',
    worldId: world.id,
    worldVersion: world.version,
    scheduleVersion: schedule.version,
    subsetsChecked: SUBSET_COUNT,
    simulatorQueries: SUBSET_COUNT,
    allPass: failing.length === 0,
    failing,
    digest: `cert-${digest(`${world.version}|${schedule.version}|${outcomes.join('')}`)}`,
  };
}

/** A certificate is valid only for the exact world and schedule versions it was made for. */
export function certificateMatches(cert: Certificate, world: World, schedule: Schedule): boolean {
  return cert.worldVersion === world.version && cert.scheduleVersion === schedule.version && cert.subsetsChecked === SUBSET_COUNT;
}

export interface MonotonicityReport {
  monotone: boolean;
  worldVersion: string;
  scheduleVersion: string;
  /** A failing set that passes once one more disruption is added: proof the world is not monotone. */
  counterexample: { failing: DisruptionId[]; added: DisruptionId; passes: DisruptionId[] } | null;
}

/** Checks, over the whole lattice, that adding a disruption never turns a failing set into a passing one. */
export function checkMonotone(world: World, schedule: Schedule): MonotonicityReport {
  const fails = Array.from({ length: SUBSET_COUNT }, (_, mask) => !simulate(world, schedule, mask).pass);
  for (let mask = 0; mask < SUBSET_COUNT; mask += 1) {
    if (!fails[mask]) continue;
    for (let i = 0; i < DISRUPTIONS.length; i += 1) {
      const bigger = mask | (1 << i);
      if (bigger !== mask && !fails[bigger]) {
        return { monotone: false, worldVersion: world.version, scheduleVersion: schedule.version, counterexample: { failing: idsOf(mask), added: DISRUPTIONS[i] as DisruptionId, passes: idsOf(bigger) } };
      }
    }
  }
  return { monotone: true, worldVersion: world.version, scheduleVersion: schedule.version, counterexample: null };
}
