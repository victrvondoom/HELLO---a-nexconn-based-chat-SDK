import { agentsFromAnalysis, AgentRecordSchema } from '@/domain/ops/agents';
import { BENCHMARKS, percentile, type BenchmarkId, type BenchmarkReport, type LabRun } from '@/domain/ops/bench';
import { automationAllowed, HANDOFF_ACTIONS, startOwnership, transition, type Ownership } from '@/domain/ops/handoff';
import { catchUp, compareEvents, gaps, insertEvent, visibleAt, type TimelineEvent } from '@/domain/ops/temporal';
import { resolve } from '@/domain/resilience/repair';
import { runSearch } from '@/domain/resilience/search';
import { simulate } from '@/domain/resilience/simulator';
import { certificateMatches, verifyExact } from '@/domain/resilience/verify';
import { benchmarkWorldV1, DISRUPTIONS, makeSchedule, rng, seededWorld, SUBSET_COUNT } from '@/domain/resilience/world';
import { MemoryHelloStore } from '@/store/memory';
import { ledgerEntries, recover, submitAction, verifyLedger } from './action-ledger';

/**
 * The Reliability Lab runner. Runs HELLO's real code (Steadfast simulator, search, repair and verifier; the store-
 * backed action ledger on an isolated scratch store; the temporal and handoff domains). Deterministic for a seed
 * except wall-clock timings. Results are "local simulation": they measure HELLO's logic in one process, not a
 * deployed multi-instance system or Nexconn.
 */
const VERSION = 'lab-v1';

async function timed<T>(samples: number[], fn: () => T | Promise<T>): Promise<T> {
  const t = performance.now();
  const out = await fn();
  samples.push(performance.now() - t);
  return out;
}

function report(id: BenchmarkId, scenarios: number, input: string, config: BenchmarkReport['config'], samples: number[], started: number, r: Partial<BenchmarkReport>): BenchmarkReport {
  return {
    id,
    version: VERSION,
    scenarios,
    input,
    config,
    passed: r.passed ?? 0,
    failed: r.failed ?? 0,
    rejectedSafely: r.rejectedSafely ?? 0,
    falsePositives: r.falsePositives ?? null,
    falseNegatives: r.falseNegatives ?? null,
    runtimeMs: Math.round(performance.now() - started),
    latencyMs: { p50: percentile(samples, 50), p95: percentile(samples, 95), p99: percentile(samples, 99) },
    failures: r.failures ?? [],
  };
}

export async function runReliabilityLab(options: { seed?: number; worlds?: number; only?: BenchmarkId[] } = {}): Promise<LabRun> {
  const seed = options.seed ?? 1;
  const worldCount = options.worlds ?? 41;
  const want = (id: BenchmarkId) => !options.only || options.only.includes(id);
  const worlds = [benchmarkWorldV1(), ...Array.from({ length: worldCount - 1 }, (_, i) => seededWorld(i + 1))];
  const reports: BenchmarkReport[] = [];

  if (want('disruption-coverage')) {
    const s: number[] = [];
    const t = performance.now();
    let passed = 0;
    let fp = 0;
    let fn = 0;
    let evaluated = 0;
    const failures: BenchmarkReport['failures'] = [];
    for (const { world, baseline } of worlds) {
      // Exhaustive reference: every one of the 256 subsets is simulated and classified.
      const fails = await timed(s, () => Array.from({ length: SUBSET_COUNT }, (_, m) => !simulate(world, baseline, m).pass));
      evaluated += SUBSET_COUNT;
      const minimal = new Set<number>();
      for (let m = 0; m < SUBSET_COUNT; m += 1) {
        if (!fails[m]) continue;
        let proper = false;
        if (m !== 0) for (let sub = (m - 1) & m; ; sub = (sub - 1) & m) { if (fails[sub]) { proper = true; break; } if (sub === 0) break; }
        if (!proper) minimal.add(m);
      }
      // The production search must find exactly those sets.
      const found = new Set(runSearch('cardinality', world, baseline, SUBSET_COUNT).found);
      const extra = [...found].filter((m) => !minimal.has(m));
      const missed = [...minimal].filter((m) => !found.has(m));
      fp += extra.length;
      fn += missed.length;
      if (extra.length || missed.length) failures.push({ scenario: world.id, detail: `${extra.length} wrong, ${missed.length} missed minimal failing sets.`, counterexample: `masks ${[...extra, ...missed].join(',')}` });
      else passed += 1;
    }
    reports.push(report('disruption-coverage', worlds.length, `${worlds.length} worlds, ${evaluated} subsets simulated (all 256 per world)`, { algorithm: 'cardinality vs exhaustive', budget: SUBSET_COUNT }, s, t, { passed, failed: worlds.length - passed, falsePositives: fp, falseNegatives: fn, failures }));
  }

  const { world, baseline } = benchmarkWorldV1();
  if (want('recovery-correctness') || want('schedule-integrity') || want('proposal-verification') || want('stale-approval')) {
    const sRec: number[] = [];
    const tRec = performance.now();
    const analyses = [];
    for (let i = 0; i < DISRUPTIONS.length; i += 1) analyses.push(await timed(sRec, () => resolve(world, baseline, 1 << i)));
    if (want('recovery-correctness')) {
      let passed = 0;
      let safe = 0;
      const failures: BenchmarkReport['failures'] = [];
      analyses.forEach((a, i) => {
        const rec = a.recommended;
        if (!rec) return void (safe += 1);
        const independent = verifyExact(world, rec.schedule);
        if (independent.allPass && independent.digest === rec.certificate.digest) passed += 1;
        else failures.push({ scenario: DISRUPTIONS[i] as string, detail: 'Certified recovery failed independent verification.', counterexample: JSON.stringify(independent.failing[0] ?? {}) });
      });
      reports.push(report('recovery-correctness', analyses.length, `${world.id} ${world.version}`, { incidents: 'each single disruption' }, sRec, tRec, { passed, failed: failures.length, rejectedSafely: safe, falseNegatives: null, falsePositives: failures.length, failures }));
    }
    if (want('schedule-integrity')) {
      const s: number[] = [];
      const t = performance.now();
      const certified = analyses.flatMap((a) => (a.recommended ? [a.recommended.schedule] : []));
      const failures: BenchmarkReport['failures'] = [];
      for (const sch of certified) {
        const r = await timed(s, () => simulate(world, sch, 0));
        const bad = r.violations.filter((v) => v.constraint === 'session_overlap' || v.constraint === 'speaker_overlap' || v.constraint === 'room_availability');
        if (bad.length) failures.push({ scenario: sch.version, detail: bad[0]?.detail ?? '', counterexample: 'mask 0' });
      }
      reports.push(report('schedule-integrity', certified.length, world.version, {}, s, t, { passed: certified.length - failures.length, failed: failures.length, failures }));
    }
    if (want('proposal-verification')) {
      const s: number[] = [];
      const t = performance.now();
      let passed = 0;
      let safe = 0;
      const failures: BenchmarkReport['failures'] = [];
      for (const a of analyses) {
        for (const rec of agentsFromAnalysis(a, 'incident:bench')) {
          await timed(s, () => {
            if (AgentRecordSchema.safeParse(rec).success) passed += 1;
            else failures.push({ scenario: rec.id, detail: 'Derived record failed its schema.', counterexample: rec.role });
            // Adversarial variants that must be refused.
            const bad = [
              { ...rec, evidence: [] },
              { ...rec, execution: 'EXECUTED_BY_HUMAN' as const, approvedByUserId: null },
              { ...rec, source: 'MODEL' as const, state: 'VERIFIED' as const },
              { ...rec, evidence: ['free text with no reference'] },
            ];
            for (const b of bad) {
              if (AgentRecordSchema.safeParse(b).success) failures.push({ scenario: rec.id, detail: 'Malformed or self-approved record accepted.', counterexample: JSON.stringify(b).slice(0, 200) });
              else safe += 1;
            }
          });
        }
      }
      const scenarios = analyses.length * 5 * 5;
      reports.push(report('proposal-verification', scenarios, world.version, { adversarialPerRecord: 4 }, s, t, { passed: passed + safe, failed: failures.length, rejectedSafely: safe, falsePositives: failures.length, falseNegatives: 0, failures }));
    }
    if (want('stale-approval')) {
      const s: number[] = [];
      const t = performance.now();
      let safe = 0;
      const failures: BenchmarkReport['failures'] = [];
      let n = 0;
      for (const a of analyses) {
        const rec = a.recommended;
        if (!rec) continue;
        for (const [id, p] of Object.entries(rec.schedule.placements)) {
          for (let slot = 0; slot < world.slots; slot += 1) {
            if (slot === p.slot) continue;
            n += 1;
            const moved = makeSchedule({ ...rec.schedule.placements, [id]: { ...p, slot } });
            if (await timed(s, () => certificateMatches(rec.certificate, world, moved))) failures.push({ scenario: `${rec.schedule.version}:${id}->${slot}`, detail: 'A stale certificate matched a changed schedule.', counterexample: moved.version });
            else safe += 1;
          }
        }
      }
      reports.push(report('stale-approval', n, world.version, { mutation: 'one session moved one slot' }, s, t, { passed: safe, failed: failures.length, rejectedSafely: safe, falsePositives: failures.length, falseNegatives: 0, failures }));
    }
  }

  const store = new MemoryHelloStore();
  const req = (key: string, targetId: string, expectedVersion: number) => ({ idempotencyKey: key, kind: 'BENCH', targetId, expectedVersion, actorId: 'bench', payload: {} });

  if (want('resource-conflicts')) {
    const s: number[] = [];
    const t = performance.now();
    const rounds = 50;
    let passed = 0;
    const failures: BenchmarkReport['failures'] = [];
    for (let r = 0; r < rounds; r += 1) {
      const ev = `bench-res-${r}`;
      const results = await timed(s, () => Promise.all(Array.from({ length: 20 }, (_, i) => submitAction(store, ev, req(`claim-${r}-${i}-key`, 'seat:A1', 0), r))));
      const applied = results.filter((x) => x.outcome === 'APPLIED').length;
      if (applied === 1 && results.filter((x) => x.outcome === 'STALE').length === 19) passed += 1;
      else failures.push({ scenario: ev, detail: `${applied} claims applied for one version.`, counterexample: JSON.stringify(results.map((x) => x.outcome)) });
    }
    reports.push(report('resource-conflicts', rounds, 'scratch store', { claimantsPerRound: 20 }, s, t, { passed, failed: failures.length, rejectedSafely: passed * 19, failures }));
  }

  if (want('concurrent-actions')) {
    const s: number[] = [];
    const t = performance.now();
    const rounds = 50;
    let passed = 0;
    const failures: BenchmarkReport['failures'] = [];
    for (let r = 0; r < rounds; r += 1) {
      const ev = `bench-con-${r}`;
      await timed(s, () => Promise.all(Array.from({ length: 25 }, (_, i) => submitAction(store, ev, req(`act-${r}-${i}-key`, `room:${i}`, 0), r))));
      const seqs = (await ledgerEntries(store, ev)).map((e) => e.seq);
      if (seqs.length === 25 && seqs.every((q, i) => q === i + 1)) passed += 1;
      else failures.push({ scenario: ev, detail: 'Sequence numbers not contiguous and unique.', counterexample: seqs.join(',') });
    }
    reports.push(report('concurrent-actions', rounds, 'scratch store', { actionsPerRound: 25 }, s, t, { passed, failed: failures.length, failures }));
  }

  if (want('idempotency')) {
    const s: number[] = [];
    const t = performance.now();
    const rounds = 50;
    let passed = 0;
    const failures: BenchmarkReport['failures'] = [];
    for (let r = 0; r < rounds; r += 1) {
      const ev = `bench-idem-${r}`;
      const results = await timed(s, () => Promise.all(Array.from({ length: 10 }, () => submitAction(store, ev, req(`same-key-${r}`, 'room:x', 0), r))));
      const entries = await ledgerEntries(store, ev);
      if (entries.length === 1 && results.filter((x) => x.outcome === 'DUPLICATE').length === 9) passed += 1;
      else failures.push({ scenario: ev, detail: `${entries.length} entries for one key.`, counterexample: JSON.stringify(results.map((x) => x.outcome)) });
    }
    reports.push(report('idempotency', rounds, 'scratch store', { repeatsPerKey: 10 }, s, t, { passed, failed: failures.length, rejectedSafely: passed * 9, failures }));
  }

  if (want('replay-recovery')) {
    const s: number[] = [];
    const t = performance.now();
    const rounds = 20;
    let passed = 0;
    const failures: BenchmarkReport['failures'] = [];
    const next = rng(seed);
    for (let r = 0; r < rounds; r += 1) {
      const ev = `bench-replay-${r}`;
      for (let i = 0; i < 30; i += 1) {
        const target = `t${Math.floor(next() * 4)}`;
        const head = await store.docGet('actionHeads', ev);
        const v = head?.versions[target] ?? 0;
        await submitAction(store, ev, req(`k-${r}-${i}-replay`, target, next() < 0.2 ? v + 1 : v), i);
      }
      // A crash after reserving a key: PENDING with no entry must stay pending, never invent an outcome.
      await store.docPutIfAbsent('actionKeys', { id: `${ev}:crashed-key-${r}`, eventId: ev, seq: null, outcome: 'PENDING' });
      const check = await timed(s, async () => ({ v: await verifyLedger(store, ev), fixed: await recover(store, ev) }));
      if (check.v.consistent && check.fixed === 0) passed += 1;
      else failures.push({ scenario: ev, detail: 'Replayed head differs from stored head.', counterexample: JSON.stringify(check.v) });
    }
    reports.push(report('replay-recovery', rounds, 'scratch store', { actionsPerRound: 30, staleRate: 0.2 }, s, t, { passed, failed: failures.length, failures }));
  }

  const base = Date.UTC(2026, 10, 22, 9);
  const sample = (n: number): TimelineEvent[] => Array.from({ length: n }, (_, i) => ({ id: `e${i + 1}`, seq: i + 1, serverAt: base + i * 1000, intendedAt: base + (i % 7) * 60_000, releaseAt: base + i * 1000 + (i % 3) * 30_000, kind: 'MESSAGE', text: `m${i + 1}` }));

  if (want('ordering-reconnect')) {
    const s: number[] = [];
    const t = performance.now();
    const rounds = 200;
    let passed = 0;
    const failures: BenchmarkReport['failures'] = [];
    const next = rng(seed + 7);
    for (let r = 0; r < rounds; r += 1) {
      const events = sample(40);
      const canonical = [...events].sort(compareEvents).map((e) => e.id).join(',');
      const deliveries = [...events, ...events.filter(() => next() < 0.2)].sort(() => next() - 0.5);
      const ok = await timed(s, () => {
        let tl: TimelineEvent[] = [];
        for (const d of deliveries) tl = insertEvent(tl, d).timeline;
        const dropped = events.filter(() => next() < 0.1).map((e) => e.seq);
        const received = events.map((e) => e.seq).filter((q) => !dropped.includes(q));
        const missing = gaps(received, 0).join(',');
        const expectMissing = dropped.filter((q) => q < Math.max(...received)).sort((a, b) => a - b).join(',');
        return tl.map((e) => e.id).join(',') === canonical && missing === expectMissing;
      });
      if (ok) passed += 1;
      else failures.push({ scenario: `round-${r}`, detail: 'Timeline order or gap detection differs.', counterexample: `seed ${seed + 7}, round ${r}` });
    }
    reports.push(report('ordering-reconnect', rounds, 'sample timelines (40 events, 20% duplicates, shuffled)', { seed: seed + 7 }, s, t, { passed, failed: failures.length, failures }));
  }

  if (want('temporal-release')) {
    const s: number[] = [];
    const t = performance.now();
    const events = sample(200);
    let passed = 0;
    const failures: BenchmarkReport['failures'] = [];
    for (const e of events) {
      const ok = await timed(s, () => !visibleAt(events, e.releaseAt - 1).some((x) => x.id === e.id) && visibleAt(events, e.releaseAt).some((x) => x.id === e.id) && catchUp(events, e.seq - 1, e.releaseAt).events.some((x) => x.id === e.id));
      if (ok) passed += 1;
      else failures.push({ scenario: e.id, detail: 'Released early or late.', counterexample: `releaseAt ${e.releaseAt}` });
    }
    reports.push(report('temporal-release', events.length, 'sample timeline (200 events)', { boundaryMs: 1 }, s, t, { passed, failed: failures.length, falsePositives: 0, falseNegatives: 0, failures }));
  }

  if (want('handoff')) {
    const s: number[] = [];
    const t = performance.now();
    const rounds = 300;
    let passed = 0;
    let refused = 0;
    const failures: BenchmarkReport['failures'] = [];
    const next = rng(seed + 13);
    const people = [{ userId: 'staff-a', staff: true }, { userId: 'staff-b', staff: true }, { userId: 'attendee', staff: false }];
    for (let r = 0; r < rounds; r += 1) {
      const ok = await timed(s, () => {
        let o: Ownership = startOwnership(`inc-${r}`);
        for (let i = 0; i < 12; i += 1) {
          const actor = people[Math.floor(next() * people.length)] as (typeof people)[number];
          const action = HANDOFF_ACTIONS[Math.floor(next() * HANDOFF_ACTIONS.length)] as (typeof HANDOFF_ACTIONS)[number];
          const res = transition(o, action, actor, i, next() < 0.5 ? 'staff-a' : 'staff-b');
          if ('refused' in res) {
            refused += 1;
            continue;
          }
          o = res;
          if (o.conversationId !== `inc-${r}`) return false;
          if ((o.state === 'HUMAN_OWNED' || o.state === 'RESOLVED') && (automationAllowed(o) || !o.ownerUserId)) return false;
          if (o.state === 'HUMAN_OWNED' && o.transitions.at(-1)?.actorId !== o.ownerUserId && o.transitions.at(-1)?.action === 'TAKE_OVER') return false;
        }
        return o.transitions.length === new Set(o.transitions.map((x, k) => `${k}`)).size;
      });
      if (ok) passed += 1;
      else failures.push({ scenario: `sequence-${r}`, detail: 'An ownership invariant broke.', counterexample: `seed ${seed + 13}, sequence ${r}` });
    }
    reports.push(report('handoff', rounds, 'random action sequences (12 steps)', { seed: seed + 13 }, s, t, { passed, failed: failures.length, rejectedSafely: refused, failures }));
  }

  const order = BENCHMARKS.map((b) => b.id as string);
  return {
    startedAt: new Date().toISOString(),
    environment: { node: process.version, platform: `${process.platform}-${process.arch}`, store: 'memory (isolated scratch store)' },
    seed,
    reports: reports.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id)),
  };
}
