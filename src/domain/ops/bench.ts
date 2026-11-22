/**
 * Reliability Lab: benchmark categories and the report format. Every number in a report comes from a run of
 * HELLO's own code; nothing here holds results for other projects (the comparison table accepts submitted,
 * reproducible results only).
 */
export const BENCHMARKS = [
  { id: 'disruption-coverage', title: 'Disruption coverage', what: 'Every one of the 256 disruption subsets is simulated per world; minimal failing sets enumerated exactly.' },
  { id: 'recovery-correctness', title: 'Recovery correctness', what: 'For each single-disruption incident, a proposed recovery passes all 256 subsets when re-simulated independently.' },
  { id: 'schedule-integrity', title: 'Schedule integrity', what: 'Certified schedules have no room, speaker or session overlap with no disruption.' },
  { id: 'resource-conflicts', title: 'Resource allocation conflicts', what: 'Concurrent claims on one resource version: exactly one applies, the rest are stale.' },
  { id: 'concurrent-actions', title: 'Concurrent action safety', what: 'Concurrent actions on different targets: all apply, sequence numbers are contiguous and unique.' },
  { id: 'idempotency', title: 'Idempotency', what: 'The same request repeated concurrently is recorded once.' },
  { id: 'replay-recovery', title: 'Event replay and restart recovery', what: 'The ledger head rebuilt from the append-only entries equals the stored head; pending keys recover.' },
  { id: 'ordering-reconnect', title: 'Message ordering and reconnect', what: 'Shuffled, duplicated deliveries produce the canonical timeline; gaps after a reconnect are detected exactly.' },
  { id: 'temporal-release', title: 'Temporal release accuracy', what: 'Nothing is visible one millisecond before its release time; everything is at it.' },
  { id: 'proposal-verification', title: 'AI proposal verification', what: 'Agent records derived from Steadfast validate; malformed or self-approved records are rejected.' },
  { id: 'stale-approval', title: 'Stale approval protection', what: 'A certificate never matches a schedule changed by one move.' },
  { id: 'handoff', title: 'Human handoff correctness', what: 'Random action sequences never let automation run while a human owns the incident; the conversation never changes.' },
] as const;

export type BenchmarkId = (typeof BENCHMARKS)[number]['id'];

export interface BenchmarkReport {
  id: BenchmarkId;
  version: string;
  scenarios: number;
  input: string;
  config: Record<string, string | number>;
  passed: number;
  failed: number;
  rejectedSafely: number;
  falsePositives: number | null;
  falseNegatives: number | null;
  runtimeMs: number;
  latencyMs: { p50: number; p95: number; p99: number };
  failures: Array<{ scenario: string; detail: string; counterexample: string }>;
}

export interface LabRun {
  startedAt: string;
  environment: { node: string; platform: string; store: string };
  seed: number;
  reports: BenchmarkReport[];
}

/** Nearest-rank percentile: the smallest sample with at least p% of samples ≤ it. */
export function percentile(samples: readonly number[], p: number): number {
  if (samples.length === 0) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return Math.round((sorted[rank - 1] as number) * 1000) / 1000;
}

/** The counts of a run without timings: two runs with the same seed must produce identical fingerprints. */
export function fingerprint(run: LabRun): string {
  return JSON.stringify(run.reports.map((r) => [r.id, r.version, r.scenarios, r.passed, r.failed, r.rejectedSafely, r.falsePositives, r.falseNegatives, r.failures.map((f) => f.scenario)]));
}
