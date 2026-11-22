import { Oracle, BudgetExhausted, BY_SIZE, runSearch, type SearchResult } from './search';
import { simulate, type Violation } from './simulator';
import { checkMonotone, verifyExact, type Certificate, type MonotonicityReport } from './verify';
import { idsOf, makeSchedule, popcount, type DisruptionId, type Placement, type Schedule, type World } from './world';

/**
 * Stages D to E of CON-FUZZ: propose a fix, cost it, let an adversarial Critic attack it, verify it exactly.
 * Everything is deterministic and pure. The pipeline stops at a proposal: approving and executing it is a
 * human decision taken in the service layer (src/services/resilience.ts), never here.
 */

export interface Change {
  sessionId: string;
  from: Placement;
  to: Placement;
}

/** The cost model, stated so a saving is never invented. Units are "disruption points". */
export const COST_MODEL = {
  perSessionMoved: 10,
  perAttendeeMoved: 0.1,
  perSlotChange: 5,
  perAttendeeRetimed: 0.05,
  perZoneChange: 3,
  perSpeakerAffected: 2,
} as const;

export interface Cost {
  total: number;
  sessionsMoved: number;
  attendeesAffected: number;
  slotChanges: number;
  zoneChanges: number;
  speakersAffected: number;
}

export function changesBetween(baseline: Schedule, candidate: Schedule): Change[] {
  return Object.keys(candidate.placements)
    .sort()
    .flatMap((id) => {
      const from = baseline.placements[id];
      const to = candidate.placements[id];
      return from && to && (from.roomId !== to.roomId || from.slot !== to.slot) ? [{ sessionId: id, from, to }] : [];
    });
}

export function costOf(world: World, changes: Change[]): Cost {
  const sessions = new Map(world.sessions.map((s) => [s.id, s] as const));
  const zone = new Map(world.rooms.map((r) => [r.id, r.zone] as const));
  const c: Cost = { total: 0, sessionsMoved: 0, attendeesAffected: 0, slotChanges: 0, zoneChanges: 0, speakersAffected: 0 };
  for (const ch of changes) {
    const s = sessions.get(ch.sessionId);
    const people = s?.expected ?? 0;
    c.sessionsMoved += 1;
    c.attendeesAffected += people;
    c.total += COST_MODEL.perSessionMoved + COST_MODEL.perAttendeeMoved * people;
    if (ch.from.slot !== ch.to.slot) {
      c.slotChanges += 1;
      c.total += COST_MODEL.perSlotChange + COST_MODEL.perAttendeeRetimed * people;
    }
    if (zone.get(ch.from.roomId) !== zone.get(ch.to.roomId)) {
      c.zoneChanges += 1;
      c.total += COST_MODEL.perZoneChange;
    }
    if (s?.speakerId) {
      c.speakersAffected += 1;
      c.total += COST_MODEL.perSpeakerAffected;
    }
  }
  c.total = Math.round(c.total * 10) / 10;
  return c;
}

function failingIn(world: World, placements: Record<string, Placement>, masks: number[]): { failing: number; violations: number; violators: string[] } {
  const schedule = { version: '', placements };
  let failing = 0;
  let violations = 0;
  const violators = new Set<string>();
  for (const m of masks) {
    const r = simulate(world, schedule, m);
    if (!r.pass) {
      failing += 1;
      violations += r.violations.length;
      for (const v of r.violations) violators.add(v.sessionId);
    }
  }
  return { failing, violations, violators: [...violators].sort() };
}

const better = (a: [number, number, number], b: [number, number, number]) => a[0] < b[0] || (a[0] === b[0] && (a[1] < b[1] || (a[1] === b[1] && a[2] < b[2])));

/**
 * The proposer: greedy repair. While any disruption set it must survive still fails, it tries every move of
 * every violating session (to a free room and slot, a swap with a movable session, or a chain that moves the occupant on to a free cell) and keeps the move that
 * leaves the fewest violations across those sets, then the fewest failing sets, then the lowest cost. It may move sideways
 * across a plateau but never to a worse state or a state it has already visited. Each step is a candidate, so cheaper partial fixes can be shown and
 * rejected with evidence.
 */
export function propose(world: World, baseline: Schedule, mustSurvive: number[], options: { frozen?: ReadonlySet<string>; maxMoves?: number } = {}): Schedule[] {
  const frozen = options.frozen ?? new Set<string>();
  const maxMoves = options.maxMoves ?? 24;
  const visited = new Set<string>([baseline.version]);
  let current: Record<string, Placement> = { ...baseline.placements };
  const snapshots: Schedule[] = [];
  const cells = world.rooms.flatMap((r) => Array.from({ length: world.slots }, (_, slot) => ({ roomId: r.id, slot })));
  const keyOf = (placements: Record<string, Placement>): [number, number, number] => {
    const after = failingIn(world, placements, mustSurvive);
    return [after.violations, after.failing, costOf(world, changesBetween(baseline, makeSchedule(placements))).total];
  };

  for (let step = 0; step < maxMoves; step += 1) {
    const state = failingIn(world, current, mustSurvive);
    if (state.failing === 0) break;
    const here = keyOf(current);
    let best: { placements: Record<string, Placement>; key: [number, number, number] } | null = null;
    for (const id of state.violators.filter((v) => !frozen.has(v))) {
      for (const cell of cells) {
        const from = current[id];
        if (!from || (from.roomId === cell.roomId && from.slot === cell.slot)) continue;
        const occupant = Object.entries(current).find(([other, at]) => other !== id && at.roomId === cell.roomId && at.slot === cell.slot)?.[0];
        if (occupant && frozen.has(occupant)) continue;
        // Either a swap, or (an ejection chain) the occupant moves on to any free cell.
        const options: Array<Record<string, Placement>> = [{ ...current, [id]: cell, ...(occupant ? { [occupant]: from } : {}) }];
        if (occupant) {
          for (const free of cells) {
            const taken = Object.entries(current).some(([other, at]) => other !== id && at.roomId === free.roomId && at.slot === free.slot);
            if (!taken && !(free.roomId === cell.roomId && free.slot === cell.slot)) options.push({ ...current, [id]: cell, [occupant]: free });
          }
        }
        for (const next of options) {
          if (visited.has(makeSchedule(next).version)) continue;
          const key = keyOf(next);
          if (!best || better(key, best.key)) best = { placements: next, key };
        }
      }
    }
    // A sideways move (no more violations than now) is allowed, so a chain of moves can cross a plateau;
    // states already visited are never revisited, so it cannot loop.
    if (!best || best.key[0] > here[0] || (best.key[0] === here[0] && best.key[1] > here[1])) break;
    current = best.placements;
    const snapshot = makeSchedule(current);
    visited.add(snapshot.version);
    snapshots.push(snapshot);
  }
  return snapshots;
}

export interface CriticResult {
  witness: { mask: number; disruptions: DisruptionId[]; violations: Violation[] } | null;
  queries: number;
  exhausted: boolean;
  /** The attacks tried, most suspicious first: the incident with each further disruption, then the rest. */
  strategy: string;
}

/**
 * The adversarial Critic. It tries to break a candidate rather than agree with it: first the incident
 * combined with every other disruption, smallest additions first, then every other combination. A claim only
 * counts when the simulator confirms it; the Critic's own opinion is never evidence.
 */
export function attack(world: World, candidate: Schedule, incidentMask: number, budget: number): CriticResult {
  const oracle = new Oracle(world, candidate, budget);
  const order = [...BY_SIZE.filter((m) => (m & incidentMask) === incidentMask), ...BY_SIZE.filter((m) => (m & incidentMask) !== incidentMask)];
  try {
    for (const mask of order) {
      const r = oracle.run(mask);
      if (!r.pass) return { witness: { mask, disruptions: idsOf(mask), violations: r.violations }, queries: oracle.queries, exhausted: false, strategy: 'incident-supersets-first' };
    }
  } catch (e) {
    if (!(e instanceof BudgetExhausted)) throw e;
    return { witness: null, queries: oracle.queries, exhausted: true, strategy: 'incident-supersets-first' };
  }
  return { witness: null, queries: oracle.queries, exhausted: false, strategy: 'incident-supersets-first' };
}

export interface Alternative {
  schedule: Schedule;
  changes: Change[];
  cost: Cost;
  /** The disruption set that still breaks it, and what breaks. */
  failsUnder: { disruptions: DisruptionId[]; constraints: string[] } | null;
  rejectedBy: 'critic' | 'exact verification' | null;
}

export interface Analysis {
  worldId: string;
  worldVersion: string;
  baselineVersion: string;
  incident: DisruptionId[];
  baseline: { pass: boolean; violations: Violation[]; affectedSessions: string[] };
  monotonicity: MonotonicityReport;
  discovery: SearchResult & { minimalFailingSets: DisruptionId[][] };
  rounds: Array<{ round: number; candidateVersion: string; critic: CriticResult; verified: boolean | null }>;
  recommended: (Alternative & { certificate: Certificate }) | null;
  rejected: Alternative[];
  /** The Critic's most damaging attack on the final proposal, or the strongest it tried if it found none. */
  strongestAttack: string;
}

export interface ResolveOptions {
  searchBudget?: number;
  criticBudget?: number;
  maxRounds?: number;
  frozen?: ReadonlySet<string>;
}

export function resolve(world: World, baseline: Schedule, incidentMask: number, options: ResolveOptions = {}): Analysis {
  const base = simulate(world, baseline, incidentMask);
  const monotonicity = checkMonotone(world, baseline);
  const search = runSearch('monotone', world, baseline, options.searchBudget ?? 256, { monotoneCertified: monotonicity.monotone });
  // The proposer anticipates the incident and the incident with any one more disruption; the Critic adds
  // whatever else it can break the proposal with.
  const mustSurvive = [incidentMask, ...Array.from({ length: 8 }, (_, i) => incidentMask | (1 << i)).filter((m) => m !== incidentMask)];
  const rounds: Analysis['rounds'] = [];
  const rejected: Alternative[] = [];
  const seen = new Set<string>();
  let recommended: Analysis['recommended'] = null;
  let strongestAttack = 'No attack was needed.';

  const reject = (schedule: Schedule, under: { disruptions: DisruptionId[]; constraints: string[] }, by: Alternative['rejectedBy']) => {
    if (seen.has(schedule.version)) return;
    seen.add(schedule.version);
    const changes = changesBetween(baseline, schedule);
    rejected.push({ schedule, changes, cost: costOf(world, changes), failsUnder: under, rejectedBy: by });
  };

  for (let round = 1; round <= (options.maxRounds ?? 12); round += 1) {
    const steps = propose(world, baseline, mustSurvive, { frozen: options.frozen });
    const candidate = steps.at(-1) ?? baseline;
    // A proposal must at least survive every disruption set it was asked to; otherwise the proposer is stuck.
    if (failingIn(world, candidate.placements, mustSurvive).failing > 0) break;
    // Every cheaper intermediate step is an alternative too: verify it, and keep why it fails.
    for (const step of steps.slice(0, -1)) {
      const cert = verifyExact(world, step);
      const f = cert.failing[0];
      if (f) reject(step, { disruptions: f.disruptions, constraints: f.constraints }, 'exact verification');
    }
    const critic = attack(world, candidate, incidentMask, options.criticBudget ?? 64);
    if (critic.witness) {
      strongestAttack = `${critic.witness.disruptions.join(' + ') || 'no disruption'} breaks it: ${critic.witness.violations[0]?.detail ?? ''}`;
      rounds.push({ round, candidateVersion: candidate.version, critic, verified: null });
      reject(candidate, { disruptions: critic.witness.disruptions, constraints: [...new Set(critic.witness.violations.map((v) => v.constraint))] }, 'critic');
      mustSurvive.push(critic.witness.mask);
      continue;
    }
    const cert = verifyExact(world, candidate);
    rounds.push({ round, candidateVersion: candidate.version, critic, verified: cert.allPass });
    if (!cert.allPass) {
      const f = cert.failing[0];
      if (f) {
        reject(candidate, { disruptions: f.disruptions, constraints: f.constraints }, 'exact verification');
        mustSurvive.push(f.mask);
      }
      continue;
    }
    strongestAttack = `The Critic tried ${critic.queries} disruption combinations${critic.exhausted ? ' (its budget ran out)' : ''} starting from the incident and found none that breaks this plan; exact verification then checked all 256.`;
    const changes = changesBetween(baseline, candidate);
    recommended = { schedule: candidate, changes, cost: costOf(world, changes), failsUnder: null, rejectedBy: null, certificate: cert };
    break;
  }

  return {
    worldId: world.id,
    worldVersion: world.version,
    baselineVersion: baseline.version,
    incident: idsOf(incidentMask),
    baseline: { pass: base.pass, violations: base.violations, affectedSessions: [...new Set(base.violations.map((v) => v.sessionId))].sort() },
    monotonicity,
    discovery: { ...search, minimalFailingSets: search.found.sort((a, b) => popcount(a) - popcount(b) || a - b).map(idsOf) },
    rounds,
    recommended,
    rejected: rejected.sort((a, b) => a.cost.total - b.cost.total),
    strongestAttack,
  };
}
