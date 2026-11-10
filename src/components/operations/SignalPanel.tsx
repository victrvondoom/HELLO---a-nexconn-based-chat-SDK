'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export interface SignalRow {
  id: string;
  explanation: string;
  recommendation: string;
  confidence: number;
  distinctReporters: number;
  reviewStatus: string;
  reportIds: string[];
}

export function SignalPanel({ eventId, canReview, patterns }: { eventId: string; canReview: boolean; patterns: SignalRow[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setBusy('refresh');
    setError(null);
    try {
      const response = await fetch(`/api/events/${eventId}/signals/refresh`, { method: 'POST' });
      const json = (await response.json()) as { ok: true } | { ok: false; error: { message: string } };
      if (!json.ok) setError(json.error.message);
      router.refresh();
    } catch {
      setError('Could not recompute signals. Check your connection and try again.');
    } finally {
      setBusy(null);
    }
  }

  async function review(id: string, decision: 'ACCEPTED' | 'REJECTED') {
    setBusy(id);
    setError(null);
    try {
      const response = await fetch(`/api/events/${eventId}/signals/${id}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ decision }),
      });
      const json = (await response.json()) as { ok: true } | { ok: false; error: { message: string } };
      if (!json.ok) setError(json.error.message);
      router.refresh();
    } catch {
      setError('The review was not recorded. Try again.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="stack">
      <div className="row">
        <button type="button" className="button button--ghost" onClick={() => void refresh()} disabled={busy !== null}>
          {busy === 'refresh' ? 'Recomputing…' : 'Recompute from stored reports'}
        </button>
      </div>
      {error ? (
        <p role="alert" className="notice notice--error" style={{ margin: 0 }}>
          {error}
        </p>
      ) : null}
      {patterns.length === 0 ? (
        <div className="empty">No emerging pattern. A pattern needs three independent reporters within ten minutes.</div>
      ) : (
        patterns.map((p) => (
          <article key={p.id} className="card card__body stack small" aria-label="Detected pattern">
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <strong>Pattern · {p.distinctReporters} reporters</strong>
              <span className="badge">Confidence {p.confidence.toFixed(2)}</span>
            </div>
            <p style={{ margin: 0 }}>{p.explanation}</p>
            <p className="muted" style={{ margin: 0 }}>
              Suggested: {p.recommendation}
            </p>
            <div className="small muted">Source reports: {p.reportIds.length}</div>
            <div className="row">
              {p.reviewStatus === 'PENDING_REVIEW' ? (
                canReview ? (
                  <>
                    <button type="button" className="button" disabled={busy !== null} onClick={() => void review(p.id, 'ACCEPTED')}>
                      Accept insight
                    </button>
                    <button type="button" className="button button--ghost" disabled={busy !== null} onClick={() => void review(p.id, 'REJECTED')}>
                      Reject
                    </button>
                  </>
                ) : (
                  <span className="badge badge--warning">Awaiting organiser review</span>
                )
              ) : (
                <span className={p.reviewStatus === 'ACCEPTED' ? 'badge badge--success' : 'badge badge--danger'}>
                  {p.reviewStatus === 'ACCEPTED' ? 'Accepted by organiser' : 'Rejected by organiser'}
                </span>
              )}
            </div>
          </article>
        ))
      )}
    </div>
  );
}
