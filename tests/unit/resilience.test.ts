import { describe, expect, it } from 'vitest';
import { simulate } from '@/domain/resilience/simulator';
import { Oracle, runSearch } from '@/domain/resilience/search';
import { attack, changesBetween, costOf, resolve } from '@/domain/resilience/repair';
import { certificateMatches, checkMonotone, verifyExact } from '@/domain/resilience/verify';
import { DISRUPTIONS, FULL_MASK, SUBSET_COUNT, benchmarkWorldV1, idsOf, makeSchedule, maskOf } from '@/domain/resilience/world';
import { minimalFailingSets } from '../resilience/groundtruth';

const { world, baseline } = benchmarkWorldV1();

describe('CON-FUZZ world and simulator', () => {
  it('matches the v1 benchmark assumptions', () => {
    expect(world.sessions).toHaveLength(12);
    expect(world.rooms.filter((r) => !r.standby)).toHaveLength(5);
    expect(world.rooms.filter((r) => r.standby)).toHaveLength(1);
    expect(world.slots).toBe(4);
    expect(new Set(world.rooms.map((r) => r.zone)).size).toBe(2);
    expect(DISRUPTIONS).toHaveLength(8);
    expect(SUBSET_COUNT).toBe(256);
  });

  it('is deterministic and the baseline works with no disruption', () => {
    expect(simulate(world, baseline, 0).pass).toBe(true);
    for (const mask of [0, 5, 77, FULL_MASK]) expect(simulate(world, baseline, mask)).toEqual(simulate(world, baseline, mask));
  });

  it('fails exactly when some constraint margin is negative', () => {
    for (let mask = 0; mask < SUBSET_COUNT; mask += 1) {
      const r = simulate(world, baseline, mask);
      expect(r.pass).toBe(Object.values(r.margins).every((m) => m >= 0));
    }
  });

  it('applies the playbook: a lost room moves to the standby room, and both lost leaves no room', () => {
    const lost = simulate(world, baseline, maskOf(['primary_room_loss']));
    expect(lost.effective.S01).toEqual({ roomId: 'SB', slot: 0 });
    expect(lost.pass).toBe(true);
    const both = simulate(world, baseline, maskOf(['primary_room_loss', 'standby_room_loss']));
    expect(both.violations.some((v) => v.constraint === 'room_availability' && v.sessionId === 'S01')).toBe(true);
  });
});

describe('CON-FUZZ search', () => {
  it('counts each distinct query once and serves repeats from the cache for free', () => {
    const oracle = new Oracle(world, baseline, 3);
    oracle.run(1);
    oracle.run(1);
    oracle.run(2);
    expect(oracle.queries).toBe(2);
    oracle.run(3);
    expect(() => oracle.run(4)).toThrow(/budget/);
  });

  it('enumerates the minimal failing sets exactly with a full budget', () => {
    const truth = minimalFailingSets(world, baseline);
    const found = runSearch('cardinality', world, baseline, 256).found;
    expect(new Set(found)).toEqual(new Set(truth));
    expect(truth.map(idsOf)).toContainEqual(['primary_room_loss', 'standby_room_loss']);
  });

  it('reports the v1 world as not monotone, with a real counterexample, and so never prunes on it', () => {
    const report = checkMonotone(world, baseline);
    expect(report.monotone).toBe(false);
    const c = report.counterexample;
    if (!c) throw new Error('expected a counterexample');
    expect(simulate(world, baseline, maskOf(c.failing)).pass).toBe(false);
    expect(simulate(world, baseline, maskOf(c.passes)).pass).toBe(true);
    expect(runSearch('monotone', world, baseline, 256, { monotoneCertified: report.monotone }).pruning).toBe('disabled');
  });
});

describe('CON-FUZZ repair, Critic and exact verification', () => {
  const incident = maskOf(['step_free_route_closure']);
  const analysis = resolve(world, baseline, incident);

  it('reproduces the incident on the baseline', () => {
    expect(analysis.baseline.pass).toBe(false);
    expect(analysis.baseline.affectedSessions.length).toBeGreaterThan(0);
  });

  it('only counts a Critic attack that the simulator confirms', () => {
    for (const round of analysis.rounds) {
      const w = round.critic.witness;
      if (w) expect(simulate(world, { version: round.candidateVersion, placements: analysis.rejected.find((r) => r.schedule.version === round.candidateVersion)?.schedule.placements ?? {} }, w.mask).pass).toBe(false);
    }
    expect(analysis.rounds.some((r) => r.critic.witness !== null)).toBe(true);
  });

  it('certifies the recommended fix by checking all 256 subsets of the exact schedule version', () => {
    const rec = analysis.recommended;
    if (!rec) throw new Error('expected a certified fix');
    expect(rec.certificate.subsetsChecked).toBe(256);
    expect(rec.certificate.allPass).toBe(true);
    expect(certificateMatches(rec.certificate, world, rec.schedule)).toBe(true);
    for (let mask = 0; mask < SUBSET_COUNT; mask += 1) expect(simulate(world, rec.schedule, mask).pass).toBe(true);
    expect(verifyExact(world, rec.schedule).digest).toBe(rec.certificate.digest);
  });

  it('rejects a stale certificate for any other schedule version', () => {
    const rec = analysis.recommended;
    if (!rec) throw new Error('expected a certified fix');
    const other = makeSchedule({ ...rec.schedule.placements, S09: { roomId: 'A2', slot: 2 } });
    expect(certificateMatches(rec.certificate, world, other)).toBe(false);
  });

  it('shows cheaper alternatives only with the disruption that breaks each', () => {
    const rec = analysis.recommended;
    if (!rec) throw new Error('expected a certified fix');
    const cheaper = analysis.rejected.filter((r) => r.cost.total < rec.cost.total);
    expect(cheaper.length).toBeGreaterThan(0);
    for (const alt of cheaper) {
      if (!alt.failsUnder) throw new Error('a rejected alternative must say why');
      expect(simulate(world, alt.schedule, maskOf(alt.failsUnder.disruptions)).pass).toBe(false);
    }
  });

  it('costs changes with the stated model only', () => {
    expect(costOf(world, [])).toMatchObject({ total: 0, sessionsMoved: 0 });
    const moved = makeSchedule({ ...baseline.placements, S09: { roomId: 'B2', slot: 3 } });
    const c = costOf(world, changesBetween(baseline, moved));
    // 10 + 0.1*40 + slot change (5 + 0.05*40) + zone change 3 + speaker 2
    expect(c.total).toBe(26);
  });

  it('lets the Critic report a budget it ran out of, rather than claim the plan is safe', () => {
    const r = attack(world, baseline, incident, 1);
    expect(r.witness === null ? r.exhausted : true).toBe(true);
  });
});
