'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useFeedback } from '@/components/ui/Feedback';

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

function statusTone(row: ApprovalRow, expired: boolean): string {
  if (expired) return 'badge';
  if (row.status === 'APPROVED') return 'badge badge--success';
  if (row.status === 'REJECTED') return 'badge badge--danger';
  return 'badge badge--warning';
}

export function ApprovalQueue({ eventId, canDecide, viewerId, approvals, nowMs }: Props) {
  const router = useRouter();
  const { toast, confirm } = useFeedback();
  const [busy, setBusy] = useState<string | null>(null);
  const [reasons, setReasons] = useState<Record<string, string>>({});

  async function decide(row: ApprovalRow, decision: 'APPROVE' | 'REJECT') {
    const reason = (reasons[row.id] ?? '').trim();
    if (decision === 'REJECT' && reason.length < 3) {
      toast('error', 'Give a reason of at least three characters before rejecting.');
      return;
    }
    if (decision === 'APPROVE') {
      const ok = await confirm({
        title: 'Approve and execute this change?',
        body: 'HELLO will attempt the change immediately and record the outcome. A failed attempt is shown here and changes nothing.',
        confirmLabel: 'Approve and execute',
      });
      if (!ok) return;
    }
    setBusy(row.id);
    try {
      const response = await fetch(`/api/events/${eventId}/approvals/${row.id}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ decision, reason: reason || 'Approved', expectedVersion: row.version }),
      });
      const json = (await response.json()) as { ok: true; data: { executionStatus: string; executionResult: string | null } } | { ok: false; error: { message: string } };
      if (!json.ok) {
        toast('error', json.error.message);
      } else if (decision === 'REJECT') {
        toast('success', 'Request rejected. The requester has been told why.');
      } else if (json.data.executionStatus === 'SUCCEEDED') {
        toast('success', json.data.executionResult ?? 'Approved and executed.');
      } else {
        toast('error', `Approved, but execution failed: ${json.data.executionResult ?? 'unknown reason'}`);
      }
      router.refresh();
    } catch {
      toast('error', 'The decision was not recorded because the connection failed. Nothing has changed.');
    } finally {
      setBusy(null);
    }
  }

  if (approvals.length === 0) {
    return (
      <div className="empty">
        <strong>Nothing waiting for a decision</strong>
        <span>Room changes and announcements appear here when someone asks for one.</span>
      </div>
    );
  }

  return (
    <ul className="stack list-reset" style={{ gap: 12 }}>
      {approvals.map((row) => {
        const expired = row.status === 'PENDING' && nowMs >= row.expiresAt;
        const own = row.requestedByUserId === viewerId;
        const canAct = row.status === 'PENDING' && !expired && canDecide && !own;
        return (
          <li key={row.id} className="card card--raised">
            <article className="card__body stack" style={{ gap: 8 }} aria-label={`${row.actionType} request`}>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <strong>{row.actionType.replace(/_/g, ' ').toLowerCase()}</strong>
                <span className={statusTone(row, expired)}>{expired ? 'expired' : row.status.toLowerCase()}</span>
              </div>
              <p className="small muted">{row.justification}</p>
              <p className="mono faint">{row.payloadSummary}</p>
              {row.status === 'APPROVED' ? (
                <p className={row.executionStatus === 'SUCCEEDED' ? 'notice notice--info small' : 'notice notice--error small'}>
                  Execution {row.executionStatus === 'SUCCEEDED' ? 'succeeded' : 'failed'}
                  {row.executionResult ? `: ${row.executionResult}` : ''}
                </p>
              ) : null}
              {row.status === 'REJECTED' && row.decisionReason ? (
                <p className="small muted">Rejected: {row.decisionReason}</p>
              ) : null}
              {canAct ? (
                <div className="stack" style={{ gap: 10, marginTop: 4 }}>
                  <div className="field">
                    <label htmlFor={`reason-${row.id}`}>Reason (required to reject)</label>
                    <input
                      id={`reason-${row.id}`}
                      value={reasons[row.id] ?? ''}
                      onChange={(e) => {
                        setReasons((prev) => ({ ...prev, [row.id]: e.target.value }));
                      }}
                      maxLength={500}
                    />
                  </div>
                  <div className="row">
                    <button type="button" className="button" disabled={busy !== null} onClick={() => void decide(row, 'APPROVE')}>
                      {busy === row.id ? 'Working…' : 'Approve and execute'}
                    </button>
                    <button type="button" className="button button--ghost" disabled={busy !== null} onClick={() => void decide(row, 'REJECT')}>
                      Reject
                    </button>
                  </div>
                </div>
              ) : own && row.status === 'PENDING' ? (
                <p className="small faint">You requested this, so another organiser must decide it.</p>
              ) : null}
            </article>
          </li>
        );
      })}
    </ul>
  );
}
