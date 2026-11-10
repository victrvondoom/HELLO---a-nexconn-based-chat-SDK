import { notFound } from 'next/navigation';
import { loadEventViewer } from '@/lib/viewer';
import { getOperationsOverview } from '@/services/sessions';
import { listIncidentsForViewer } from '@/services/incidents';
import { listApprovalsForViewer } from '@/services/approvals';
import { STATUS_LABEL } from '@/domain/labels';
import { IncidentBadge } from '@/components/incidents/IncidentBadge';
import { ApprovalQueue } from '@/components/operations/ApprovalQueue';
import { SignalPanel } from '@/components/operations/SignalPanel';
import { formatUtc } from '@/components/ui/labels';
import { listSignalPatternsFor } from './data';

export const dynamic = 'force-dynamic';

export default async function OperationsPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  const viewer = await loadEventViewer(eventId);
  if (!viewer.can('incident.read.operational')) {
    notFound();
  }
  const canDecide = viewer.can('approval.decide');
  const canReviewSignals = viewer.can('signal.review');

  const rooms = await getOperationsOverview(viewer.ctx, eventId, viewer.userId);
  const incidents = (await listIncidentsForViewer(viewer.ctx, eventId, viewer.userId)).filter(
    (row) => !['CLOSED', 'CANCELLED', 'CONFIRMED'].includes(row.incident.status),
  );
  const approvals = await listApprovalsForViewer(viewer.ctx, eventId, viewer.userId);
  const signals = await listSignalPatternsFor(viewer.store, eventId);
  const now = viewer.ctx.now();

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Operations</h1>
          <p className="muted small" style={{ margin: 0 }}>
            Live state of rooms, open work, approvals and emerging patterns. Every figure states where it came from.
          </p>
        </div>
      </div>

      <section className="card card__body stack" aria-labelledby="rooms-heading">
        <h2 id="rooms-heading">Rooms and occupancy</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">Room</th>
                <th scope="col">Occupancy</th>
                <th scope="col">Sessions</th>
                <th scope="col">Open incidents</th>
              </tr>
            </thead>
            <tbody>
              {rooms.map((r) => (
                <tr key={r.room.id}>
                  <td>
                    <strong>{r.room.name}</strong>
                    <div className="small muted">
                      Capacity {r.room.capacity} · {r.room.zone}
                    </div>
                  </td>
                  <td>
                    {r.occupancyLabel}
                    {r.overCapacity ? (
                      <div>
                        <span className={r.overCapacityIsVerified ? 'badge badge--danger' : 'badge badge--warning'}>
                          {r.overCapacityIsVerified ? 'Over capacity (verified)' : 'Over capacity in recorded data'}
                        </span>
                      </div>
                    ) : null}
                  </td>
                  <td>
                    {r.sessionsToday.map((s) => (
                      <div key={s.id} className="small">
                        {s.title} · {s.enrolled}/{s.capacity} enrolled
                      </div>
                    ))}
                  </td>
                  <td>{r.openIncidentCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="split split--even" style={{ marginTop: 24 }}>
        <section className="card card__body stack" aria-labelledby="open-heading">
          <h2 id="open-heading">Open incidents ({incidents.length})</h2>
          {incidents.length === 0 ? (
            <div className="empty">Nothing open right now.</div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Incident</th>
                    <th scope="col">Status</th>
                    <th scope="col">Reports</th>
                    <th scope="col">Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {incidents.map(({ incident, reportCount }) => (
                    <tr key={incident.id}>
                      <td>
                        <a href={`/events/${eventId}/incidents/${incident.id}`}>{incident.title}</a>
                        <div className="small muted">
                          {incident.assigneeUserId ? 'Owned' : 'Unowned'} · {incident.urgency.toLowerCase()}
                        </div>
                      </td>
                      <td>
                        <IncidentBadge status={incident.status} />
                        <div className="small muted">{STATUS_LABEL[incident.status]}</div>
                      </td>
                      <td>{reportCount}</td>
                      <td className="small" title={formatUtc(incident.updatedAt)}>
                        {Math.max(0, Math.round((now - incident.updatedAt) / 60000))} min ago
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <div className="stack">
          <section className="card card__body stack" aria-labelledby="approvals-heading">
            <h2 id="approvals-heading">Approval queue</h2>
            <p className="small muted" style={{ margin: 0 }}>
              Consequential changes wait here. An approval is recorded separately from execution, which can still fail.
            </p>
            <ApprovalQueue
              eventId={eventId}
              canDecide={canDecide}
              viewerId={viewer.userId}
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
                payloadSummary: Object.entries(a.payload)
                  .map(([k, v]) => `${k}: ${v}`)
                  .join(' · '),
              }))}
              nowMs={now}
            />
          </section>

          <section className="card card__body stack" aria-labelledby="signals-heading">
            <h2 id="signals-heading">Signal intelligence</h2>
            <p className="small muted" style={{ margin: 0 }}>
              Patterns are suggestions built only from stored reports. Each counts independent people once.
            </p>
            <SignalPanel
              eventId={eventId}
              canReview={canReviewSignals}
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
    </>
  );
}
