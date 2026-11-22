'use client';

import { useState } from 'react';
import { api, errorText } from '@/components/live/client';
import { BENCHMARKS, type LabRun } from '@/domain/ops/bench';

/** Runs the Reliability Lab on request and shows every number it produced, with failures and counterexamples. */
export function LabRunner({ eventId }: { eventId: string }) {
  const [run, setRun] = useState<LabRun | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const title = (id: string) => BENCHMARKS.find((b) => b.id === id)?.title ?? id;
  return (
    <div className="stack" style={{ gap: 10 }}>
      <div className="row" style={{ gap: 8, alignItems: 'center' }}>
        <button
          type="button"
          className="button button--sm"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            setError(null);
            api<LabRun>(`/api/events/${eventId}/ops/lab`, 'POST').then(setRun, (e: unknown) => { setError(errorText(e)); }).finally(() => { setBusy(false); });
          }}
        >
          {busy ? 'Running 12 benchmarks…' : run ? 'Run again' : 'Run the Reliability Lab'}
        </button>
        {run ? <span className="xs faint">Seed {run.seed} · {run.environment.node} · {run.environment.platform} · {run.environment.store} · {run.startedAt}</span> : null}
      </div>
      {error ? <p role="alert" className="notice notice--error" style={{ margin: 0 }}>{error}</p> : null}
      {run ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th scope="col">Benchmark</th><th scope="col">Scenarios</th><th scope="col">Passed</th><th scope="col">Failed</th><th scope="col">Rejected safely</th><th scope="col">FP / FN</th><th scope="col">p50 / p95 / p99 ms</th></tr>
            </thead>
            <tbody>
              {run.reports.map((r) => (
                <tr key={r.id}>
                  <td>
                    <strong>{title(r.id)}</strong>
                    <div className="xs faint">{r.input} · {r.version}</div>
                    {r.failures.map((f) => <div key={f.scenario} className="xs" style={{ color: 'var(--danger)' }}>{f.scenario}: {f.detail} Counterexample: {f.counterexample}</div>)}
                  </td>
                  <td>{r.scenarios}</td>
                  <td>{r.passed}</td>
                  <td style={{ color: r.failed ? 'var(--danger)' : undefined }}>{r.failed}</td>
                  <td>{r.rejectedSafely}</td>
                  <td>{r.falsePositives ?? '—'} / {r.falseNegatives ?? '—'}</td>
                  <td className="xs">{r.latencyMs.p50} / {r.latencyMs.p95} / {r.latencyMs.p99}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="small muted" style={{ margin: 0 }}>Results appear here after a run. Nothing is shown before one.</p>
      )}
    </div>
  );
}
