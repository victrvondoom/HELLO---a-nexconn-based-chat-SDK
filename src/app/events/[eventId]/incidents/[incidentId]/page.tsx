import Link from 'next/link';
import { notFound } from 'next/navigation';
import { loadEventViewer } from '@/lib/viewer';
import { getIncidentDetail } from '@/services/incidents';
import { DomainError } from '@/domain/errors';
import { STATUS_LABEL } from '@/domain/labels';
import { formatUtc, URGENCY_LABEL } from '@/components/ui/labels';
import { IncidentBadge } from '@/components/incidents/IncidentBadge';
import { IncidentActions } from '@/components/incidents/IncidentActions';

export const dynamic = 'force-dynamic';

export default async function IncidentDetailPage({
  params,
}: {
  params: Promise<{ eventId: string; incidentId: string }>;
}) {
  const { eventId, incidentId } = await params;
  const viewer = await loadEventViewer(eventId);
  let detail;
  try {
    detail = await getIncidentDetail(viewer.ctx, eventId, viewer.userId, incidentId);
  } catch (error: unknown) {
    if (error instanceof DomainError && error.code === 'NOT_FOUND') notFound();
    throw error;
  }
  const { incident, reports, timeline, assigneeName, viewerCanOperate, viewerIsReporter, allowedNextStatuses, recommendations } = detail;
  const reporterNames = new Map<string, string>();
  for (const r of reports) {
    if (!reporterNames.has(r.reporterUserId)) {
      reporterNames.set(r.reporterUserId, (await viewer.store.getUser(r.reporterUserId))?.displayName ?? 'Attendee');
    }
  }
  const room = incident.roomId ? await viewer.store.getRoom(incident.roomId) : null;

  return (
    <>
      <nav className="small muted" aria-label="Breadcrumb" style={{ marginBottom: 8 }}>
        <Link href={`/events/${eventId}/incidents`}>{viewerCanOperate ? 'Incidents' : 'My requests'}</Link> / {incident.id}
      </nav>
      <div className="page-header">
        <div>
          <h1>{incident.title}</h1>
          <p className="muted small" style={{ margin: 0 }}>
            {incident.category}
            {room ? ` · ${room.name}` : ''} · urgency {URGENCY_LABEL[incident.urgency]} · opened {formatUtc(incident.createdAt)}
          </p>
        </div>
        <IncidentBadge status={incident.status} />
      </div>

      <div className="split split--even">
        <div className="stack">
          <section className="card card__body stack" aria-labelledby="state-heading">
            <h2 id="state-heading">Current state</h2>
            <p style={{ margin: 0 }}>{STATUS_LABEL[incident.status]}</p>
            <p className="small muted" style={{ margin: 0 }}>
              Owner: {assigneeName ?? 'not yet claimed'} · version {incident.version}
            </p>
            {incident.resolutionNote ? (
              <p className="notice" style={{ margin: 0 }}>
                Resolution: {incident.resolutionNote}
              </p>
            ) : null}
            {viewerCanOperate || viewerIsReporter ? (
              <IncidentActions
                eventId={eventId}
                incidentId={incident.id}
                version={incident.version}
                status={incident.status}
                allowedNext={allowedNextStatuses}
                canClaim={viewerCanOperate && incident.assigneeUserId === null && (incident.status === 'TRIAGED' || incident.status === 'ESCALATED')}
              />
            ) : null}
          </section>

          <section className="card card__body stack" aria-labelledby="reports-heading">
            <h2 id="reports-heading">Reports ({reports.length})</h2>
            <p className="small muted" style={{ margin: 0 }}>
              Each person’s report is kept separately. Reports are attached only when room, category and time all match.
            </p>
            <ul className="stack" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {reports.map((r) => (
                <li key={r.id} className="notice small">
                  <div className="muted">
                    {viewerCanOperate ? (reporterNames.get(r.reporterUserId) ?? 'Attendee') : 'Report'} · {formatUtc(r.createdAt)}
                    {r.matchSignals.length > 0 && r.matchConfidence < 1 ? ` · matched at ${r.matchConfidence.toFixed(2)}` : ''}
                  </div>
                  <div>{r.text}</div>
                </li>
              ))}
            </ul>
          </section>
        </div>

        <div className="stack">
          {viewerCanOperate ? (
            <section className="card card__body stack" aria-labelledby="assign-heading">
              <h2 id="assign-heading">Recommended staff</h2>
              {recommendations.length === 0 ? (
                <p className="small muted" style={{ margin: 0 }}>
                  {incident.assigneeUserId ? 'Already assigned.' : 'No eligible staff are currently recommended for this status.'}
                </p>
              ) : (
                <ol className="stack small" style={{ paddingLeft: 18, margin: 0 }}>
                  {recommendations.map((r) => (
                    <li key={r.membershipId}>
                      <strong>{r.displayName}</strong> · score {r.total.toFixed(2)}
                      <div className="muted">{r.reasons.join(' ')}</div>
                    </li>
                  ))}
                </ol>
              )}
            </section>
          ) : null}

          <section className="card card__body" aria-labelledby="timeline-heading">
            <h2 id="timeline-heading">Timeline</h2>
            <ol className="timeline small">
              {timeline.map((t) => (
                <li key={t.id}>
                  <div>{t.detail}</div>
                  <div className="timeline__at">{formatUtc(t.at)}</div>
                </li>
              ))}
            </ol>
          </section>
        </div>
      </div>
    </>
  );
}
