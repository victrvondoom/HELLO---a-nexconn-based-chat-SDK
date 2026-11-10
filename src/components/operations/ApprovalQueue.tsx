'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export interface ApprovalRow {
  id: string;
  actionType: string;
  status: string;
  executionStatus: string;
  executionResult: string | null;
  justification: string;
  requestedByUserId: string;
  expiresAt: number;
  version: number;
  decisionReason: string | null;
  payloadSummary: string;
}

interface Props {
  eventId: string;
  canDecide: boolean;
  viewerId: string;
  approvals: ApprovalRow[];
  nowMs: number;
}

export function ApprovalQueue({ eventId, canDecide, viewerId, approvals, nowMs }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reasons, setReasons] = useState<Record<string, string>>({});

  async function decide(row: ApprovalRow, decision: 'APPROVE' | 'REJECT') {
    const reason = reasons[row.id] ?? '';
    if (decision === 'REJECT' && reason.trim().length < 3) {
      setError('Give a reason before rejecting a request.');
      return;
    }
    if (decision === 'APPROVE' && !window.confirm('Approve this change? HELLO will attempt it immediately and record the outcome.')) {
      return;
    }
    setBusy(row.id);
    setError(null);
    try {
      const response = await fetch(`/api/events/${eventId}/approvals/${row.id}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ decision, reason: reason.trim() || 'Approved', expectedVersion: row.version }),
      });
      const json = (await response.json()) as { ok: true } | { ok: false; error: { message: string } };
      if (!json.ok) {
        setError(json.error.message);
      }
      router.refresh();
    } catch {
      setError('The decision was not recorded because the connection failed. Nothing has changed; try again.');
    } finally {
      setBusy(null);
    }
  }

  if (approvals.length === 0) {
    return <div className="empty">No approval requests.</div>;
  }

  return (
    <div className="stack">
      {error ? (
        <p role="alert" className="notice notice--error" style={{ margin: 0 }}>
          {error}
        </p>
      ) : null}
      {approvals.map((row) => {
        const expired = row.status === 'PENDING' && nowMs >= row.expiresAt;
        const ownRequest = row.requestedByUserId === viewerId;
        return (
          <article key={row.id} className="card card__body stack small" aria-label={`${row.actionType} request`}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <strong>{row.actionType.replace(/_/g, ' ').toLowerCase()}</strong>
              <span className={row.status === 'APPROVED' ? 'badge badge--success' : row.status === 'REJECTED' ? 'badge badge--danger' : 'badge badge--warning'}>
                {expired ? 'Expired' : row.status.toLowerCase()}
              </span>
            </div>
            <div className="muted">{row.justification}</div>
            <div className="mono">{row.payloadSummary}</div>
            {row.status === 'APPROVED' ? (
              <div className={row.executionStatus === 'SUCCEEDED' ? 'notice notice--info' : 'notice notice--error'}>
                Execution {row.executionStatus.toLowerCase().replace('_', ' ')}
                {row.executionResult ? `: ${row.executionResult}` : ''}
              </div>
            ) : null}
            {row.status === 'REJECTED' && row.decisionReason ? <div className="muted">Rejected: {row.decisionReason}</div> : null}

            {row.status === 'PENDING' && !expired && canDecide ? (
              ownRequest ? (
                <p className="small muted" style={{ margin: 0 }}>
                  You requested this, so another organiser must decide it.
                </p>
              ) : (
                <div className="stack">
                  <div className="field">
                    <label htmlFor={`reason-${row.id}`}>Reason (required to reject)</label>
                    <input
                      id={`reason-${row.id}`}
                      value={reasons[row.id] ?? ''}
                      onChange={(e) => { setReasons((prev) => ({ ...prev, [row.id]: e.target.value })); }}
                      maxLength={500}
                    />
                  </div>
                  <div className="row">
                    <button type="button" className="button" disabled={busy !== null} onClick={() => void decide(row, 'APPROVE')}>
                      Approve and execute
                    </button>
                    <button type="button" className="button button--ghost" disabled={busy !== null} onClick={() => void decide(row, 'REJECT')}>
                      Reject
                    </button>
                  </div>
                </div>
              )
            ) : null}
          </article>
        );
      })}
    </div>
  );
}
