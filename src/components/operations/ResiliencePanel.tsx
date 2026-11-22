'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api, errorText } from '@/components/live/client';
import type { ScheduleProposal } from '@/domain/product';

interface Choice {
  id: string;
  label: string;
}

const STATUS: Record<ScheduleProposal['status'], string> = {
  AWAITING_APPROVAL: 'Awaiting approval',
  APPROVED: 'Approved and applied',
  REJECTED: 'Rejected',
  STALE: 'Stale: the schedule changed',
  NO_CERTIFIED_FIX: 'No certified fix found',
};

const time = (ms: number) => new Date(ms).toISOString().slice(11, 16);

/**
 * Steadfast in Operations: choose an incident (or disruptions), run the check, and read the approval card.
 * Everything on the card is simulator evidence. Approve is offered only to people who may decide, and the
 * server re-checks that and the schedule version on every decision.
 */
export function ResiliencePanel({
  eventId,
  incidents,
  disruptions,
  proposals,
  rooms,
  canDecide,
}: {
  eventId: string;
  incidents: Choice[];
  disruptions: Choice[];
  proposals: ScheduleProposal[];
  rooms: Record<string, string>;
  canDecide: boolean;
}) {
  const router = useRouter();
  const [incidentId, setIncidentId] = useState<string>(incidents[0]?.id ?? '');
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy('run');
    setError(null);
    try {
      await api(`/api/events/${eventId}/resilience`, 'POST', { incidentId: incidentId || null, ...(picked.length ? { disruptions: picked } : {}) });
      router.refresh();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  }

  async function decide(id: string, decision: 'APPROVE' | 'REJECT') {
    setBusy(id);
    setError(null);
    try {
      await api(`/api/events/${eventId}/resilience/${id}`, 'POST', { decision });
      router.refresh();
    } catch (e) {
      setError(errorText(e));
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="panel">
        <div className="panel__body stack" style={{ gap: 12 }}>
          <label className="field">
            <span className="label">Incident</span>
            <select value={incidentId} onChange={(e) => { setIncidentId(e.target.value); }}>
              <option value="">No incident: choose disruptions below</option>
              {incidents.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.label}
                </option>
              ))}
            </select>
          </label>
          <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="label">Disruptions (optional: otherwise mapped from the incident)</legend>
            <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
              {disruptions.map((d) => {
                const on = picked.includes(d.id);
                return (
                  <button key={d.id} type="button" className={on ? 'chip is-on' : 'chip'} aria-pressed={on} onClick={() => { setPicked(on ? picked.filter((x) => x !== d.id) : [...picked, d.id]); }}>
                    {d.label}
                  </button>
                );
              })}
            </div>
          </fieldset>
          {error ? (
            <p role="alert" className="notice notice--error" style={{ margin: 0 }}>
              {error}
            </p>
          ) : null}
          <div>
            <button type="button" className="button" disabled={busy !== null || (!incidentId && picked.length === 0)} onClick={() => void run()}>
              {busy === 'run' ? 'Checking 256 combinations…' : 'Run resilience check'}
            </button>
          </div>
          <p className="xs faint" style={{ margin: 0 }}>
            Deterministic simulator, no AI. A fix is certified only when all 256 combinations of the eight disruptions pass on its exact schedule version.
          </p>
        </div>
      </div>

      {proposals.length === 0 ? <p className="small muted">No checks yet.</p> : null}
      {proposals.map((p) => (
        <article key={p.id} className="card card__body stack" style={{ gap: 10 }} aria-label={`Proposal ${p.id}`}>
          <div className="split-meta">
            <strong>{p.incident.map((d) => disruptions.find((x) => x.id === d)?.label ?? d).join(' + ')}</strong>
            <span className={p.status === 'AWAITING_APPROVAL' ? 'badge badge--warning' : p.status === 'APPROVED' ? 'badge badge--success' : 'badge'}>{STATUS[p.status]}</span>
          </div>

          <details open={p.status === 'AWAITING_APPROVAL'}>
            <summary className="small">Evidence</summary>
            <div className="stack small" style={{ gap: 8, marginTop: 8 }}>
              <div>
                <strong>Baseline under the incident</strong>
                {p.evidence.baselineViolations.length === 0 ? <p className="muted" style={{ margin: 0 }}>The current schedule copes with the incident alone.</p> : (
                  <ul style={{ margin: '4px 0 0' }}>
                    {p.evidence.baselineViolations.map((v) => <li key={v}>{v}</li>)}
                  </ul>
                )}
              </div>
              <div>
                <strong>Minimal failing sets on the current schedule</strong> <span className="xs faint">({p.evidence.searchQueries} simulator queries · {p.evidence.monotone ? 'monotone world: pruning used' : 'not monotone: pruning disabled'})</span>
                <ul style={{ margin: '4px 0 0' }}>
                  {p.evidence.minimalFailingSets.map((set) => <li key={set.join('+')}>{set.join(' + ') || 'No disruption at all'}</li>)}
                </ul>
              </div>
              <div>
                <strong>Critic</strong> <span className="xs faint">({p.evidence.criticRounds} rounds)</span>
                <p style={{ margin: 0 }}>{p.evidence.strongestAttack}</p>
              </div>
              {p.evidence.rejected.length > 0 ? (
                <div>
                  <strong>Cheaper fixes, rejected</strong>
                  <ul style={{ margin: '4px 0 0' }}>
                    {p.evidence.rejected.map((r, i) => (
                      <li key={i}>
                        Cost {r.cost} ({r.moves} {r.moves === 1 ? 'move' : 'moves'}): fails under {r.failsUnder.join(' + ') || 'no disruption'} ({r.constraints.join(', ').replace(/_/g, ' ')}), found by {r.by}.
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          </details>

          {p.changes.length > 0 ? (
            <div className="small">
              <strong>Proposed change</strong> <span className="xs faint">cost {p.cost} · certificate {p.certificate?.digest} · {p.certificate?.subsetsChecked} of 256 subsets pass</span>
              <ul style={{ margin: '4px 0 0' }}>
                {p.changes.map((c) => (
                  <li key={c.sessionId}>
                    {c.title}: {rooms[c.fromRoomId] ?? c.fromRoomId} {time(c.fromStartsAt)} → <strong>{rooms[c.toRoomId] ?? c.toRoomId} {time(c.toStartsAt)}</strong> UTC
                  </li>
                ))}
              </ul>
              <p className="xs faint" style={{ margin: '6px 0 0' }}>
                On approval: {p.wouldNotify.speakers} speakers, {p.wouldNotify.attendees} attendees with it in their plan or a held seat, and {p.wouldNotify.staff} staff are told. Nobody else.
              </p>
            </div>
          ) : null}

          {p.status === 'AWAITING_APPROVAL' ? (
            canDecide ? (
              <div className="row" style={{ gap: 8 }}>
                <button type="button" className="button button--sm" disabled={busy !== null} onClick={() => void decide(p.id, 'APPROVE')}>
                  {busy === p.id ? 'Applying…' : 'Approve change'}
                </button>
                <button type="button" className="button button--sm button--ghost" disabled={busy !== null} onClick={() => void decide(p.id, 'REJECT')}>
                  Reject
                </button>
                <button type="button" className="button button--sm button--ghost" disabled={busy !== null} onClick={() => void run()}>
                  Request another proposal
                </button>
              </div>
            ) : (
              <p className="xs faint" style={{ margin: 0 }}>An organiser approves or rejects this.</p>
            )
          ) : null}
        </article>
      ))}
    </div>
  );
}
