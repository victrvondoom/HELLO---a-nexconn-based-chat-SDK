import { notFound } from 'next/navigation';
import Link from 'next/link';
import { loadEventViewer } from '@/lib/viewer';
import { getOperationsOverview } from '@/services/sessions';
import { listApprovalsForViewer } from '@/services/approvals';
import { listSlaBoard } from '@/services/workplace';
import { CATEGORY_LABEL, STATUS_LABEL } from '@/domain/labels';
import { IncidentBadge } from '@/components/incidents/IncidentBadge';
import { ApprovalQueue } from '@/components/operations/ApprovalQueue';
import { SignalPanel } from '@/components/operations/SignalPanel';
import { SlaChip } from '@/components/workplace/SlaChip';
import { SweepButton } from '@/components/workplace/SweepButton';
import { LiveRefresh } from '@/components/workplace/LiveRefresh';
import { listSignalPatternsFor } from './data';

export const dynamic = 'force-dynamic';

export default async function OperationsPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  const viewer = await loadEventViewer(eventId);
  if (!viewer.can('incident.read.operational')) {
    notFound();
  }
  const now = viewer.ctx.now();
  const [rooms, board, approvals, signals] = await Promise.all([
    getOperationsOverview(viewer.ctx, eventId, viewer.userId),
    listSlaBoard(viewer.ctx, eventId, viewer.userId),
    listApprovalsForViewer(viewer.ctx, eventId, viewer.userId),
    listSignalPatternsFor(viewer.store, eventId),
  ]);
  const breached = board.filter((r) => r.sla.state === 'BREACHED').length;
  const atRisk = board.filter((r) => r.sla.state === 'AT_RISK').length;
  const pendingApprovals = approvals.filter((a) => a.status === 'PENDING').length;
  const names = new Map<string, string>();
  for (const row of board) {
    if (row.incident.assigneeUserId && !names.has(row.incident.assigneeUserId)) {
      names.set(row.incident.assigneeUserId, (await viewer.store.getUser(row.incident.assigneeUserId))?.displayName ?? 'Someone');
    }
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Operations</h1>
          <p>Live state of open work, rooms, approvals and emerging patterns. Every figure states where it came from.</p>
        </div>
        <div className="row">
          <LiveRefresh seconds={8} />
          {viewer.can('incident.escalate') ? <SweepButton eventId={eventId} /> : null}
        </div>
      </div>

      <div className="kpi-grid" style={{ marginBottom: 20 }}>
        <div className="card kpi">
          <span className="kpi__value">{board.length}</span>
          <span className="kpi__label">Open incidents</span>
        </div>
        <div className="card kpi">
          <span className="kpi__value" style={{ color: breached > 0 ? 'var(--danger)' : undefined }}>{breached}</span>
          <span className="kpi__label">Past acknowledgement target</span>
        </div>
        <div className="card kpi">
          <span className="kpi__value" style={{ color: atRisk > 0 ? 'var(--warning)' : undefined }}>{atRisk}</span>
          <span className="kpi__label">Close to their target</span>
        </div>
        <div className="card kpi">
          <span className="kpi__value">{pendingApprovals}</span>
          <span className="kpi__label">Awaiting a decision</span>
        </div>
      </div>

      <div className="split">
        <section className="card" aria-labelledby="board-heading" style={{ overflow: 'hidden' }}>
          <div className="card__head">
            <h2 id="board-heading">Acknowledgement board</h2>
            <span className="xs faint">Most overdue first</span>
          </div>
          {board.length === 0 ? (
            <div className="empty" style={{ border: 'none' }}>
              <strong>Nothing open</strong>
              <span>New reports will appear here with their timers.</span>
            </div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Incident</th>
                    <th scope="col">Timer</th>
                    <th scope="col">Status</th>
                    <th scope="col">Owner</th>
                  </tr>
                </thead>
                <tbody>
                  {board.map(({ incident, sla }) => (
                    <tr key={incident.id}>
                      <td>
                        <Link href={`/events/${eventId}/incidents/${incident.id}`}>{incident.title}</Link>
                        <div className="xs faint">{incident.urgency.toLowerCase()} urgency · {CATEGORY_LABEL[incident.category]}</div>
                      </td>
                      <td><SlaChip sla={sla} /></td>
                      <td>
                        <IncidentBadge status={incident.status} />
                        <div className="xs faint">{STATUS_LABEL[incident.status]}</div>
                      </td>
                      <td className="small">{incident.assigneeUserId ? (names.get(incident.assigneeUserId) ?? 'Someone') : <span className="faint">Unowned</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <div className="stack" style={{ gap: 20 }}>
          <section className="card card__body stack" aria-labelledby="rooms-heading">
            <h2 id="rooms-heading">Rooms</h2>
            <ul className="list-reset list-divided">
              {rooms.map((r) => (
                <li key={r.room.id} className="split-meta" style={{ padding: '10px 0' }}>
                  <div>
                    <strong>{r.room.name}</strong>
                    <div className="xs faint">{r.occupancyLabel}</div>
                    {r.overCapacity ? (
                      <span className={r.overCapacityIsVerified ? 'badge badge--danger' : 'badge badge--warning'} style={{ marginTop: 4 }}>
                        {r.overCapacityIsVerified ? 'Over capacity (verified)' : 'Over capacity in recorded data'}
                      </span>
                    ) : null}
                  </div>
                  <span className={r.openIncidentCount > 0 ? 'badge badge--warning' : 'badge'}>
                    {r.openIncidentCount > 0 ? `${r.openIncidentCount} open` : 'Clear'}
                  </span>
                </li>
              ))}
            </ul>
          </section>

          <section className="card card__body stack" aria-labelledby="approvals-heading">
            <h2 id="approvals-heading">Approval queue</h2>
            <p className="small muted">Changes that need an organiser. Execution is recorded separately from approval.</p>
            <ApprovalQueue
              eventId={eventId}
              canDecide={viewer.can('approval.decide')}
              viewerId={viewer.userId}
              nowMs={now}
              approvals={approvals.map((a) => ({
                id: a.id,
                actionType: a.actionType,
                status: a.status,
                executionStatus: a.executionStatus,
                executionResult: a.executionResult,
                justification: a.justification,
                requestedByUserId: a.requestedByUserId,
                expiresAt: a.expiresAt,
                version: a.version,
                decisionReason: a.decisionReason,
                payloadSummary: Object.entries(a.payload).map(([k, v]) => `${k}: ${v}`).join(' · '),
              }))}
            />
          </section>

          <section className="card card__body stack" aria-labelledby="signals-heading">
            <h2 id="signals-heading">Patterns</h2>
            <p className="small muted">Built only from stored reports. Each person counts once.</p>
            <SignalPanel
              eventId={eventId}
              canReview={viewer.can('signal.review')}
              patterns={signals.map((p) => ({
                id: p.id,
                explanation: p.explanation,
                recommendation: p.recommendation,
                confidence: p.confidence,
                distinctReporters: p.distinctReporters,
                reviewStatus: p.reviewStatus,
                reportIds: p.reportIds,
              }))}
            />
          </section>
        </div>
      </div>
    </div>
  );
}
