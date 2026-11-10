import Link from 'next/link';
import { notFound } from 'next/navigation';
import { loadEventViewer } from '@/lib/viewer';
import { getIncidentDetail } from '@/services/incidents';
import { DomainError } from '@/domain/errors';
import { CATEGORY_LABEL } from '@/domain/labels';
import { slaFor } from '@/domain/incidents/sla';
import { workflowRail } from '@/domain/incidents/workflow';
import { formatUtc, URGENCY_LABEL } from '@/components/ui/labels';
import { IncidentBadge } from '@/components/incidents/IncidentBadge';
import { IncidentActions } from '@/components/incidents/IncidentActions';
import { SlaChip } from '@/components/workplace/SlaChip';
import { LiveRefresh } from '@/components/workplace/LiveRefresh';

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
  const now = viewer.ctx.now();
  const sla = slaFor(incident, now);
  const rail = workflowRail(incident.status);
  const room = incident.roomId ? await viewer.store.getRoom(incident.roomId) : null;

  const reporterNames = new Map<string, string>();
  if (viewerCanOperate) {
    for (const r of reports) {
      if (!reporterNames.has(r.reporterUserId)) {
        reporterNames.set(r.reporterUserId, (await viewer.store.getUser(r.reporterUserId))?.displayName ?? 'Attendee');
      }
    }
  }

  return (
    <div className="page">
      <nav className="xs faint" aria-label="Breadcrumb" style={{ marginBottom: 10 }}>
        <Link href={`/events/${eventId}/incidents`}>{viewerCanOperate ? 'Incidents' : 'My requests'}</Link>
        <span aria-hidden="true"> / </span>
        <span>{incident.id}</span>
      </nav>

      <div className="page-header">
        <div>
          <h1>{incident.title}</h1>
          <p>
            {CATEGORY_LABEL[incident.category]}
            {room ? ` · ${room.name}` : ''} · {URGENCY_LABEL[incident.urgency].toLowerCase()} urgency · opened {formatUtc(incident.createdAt)}
          </p>
        </div>
        <div className="row">
          <IncidentBadge status={incident.status} />
          <SlaChip sla={sla} />
          <LiveRefresh seconds={6} />
        </div>
      </div>

      <section className="card card__body" aria-labelledby="rail-heading" style={{ marginBottom: 20 }}>
        <div className="split-meta" style={{ marginBottom: 12 }}>
          <h2 id="rail-heading">Progress</h2>
          <span className="small muted">{rail.position}</span>
        </div>
        <ol className="rail" aria-label="Workflow stages">
          {rail.stages.map((s) => (
            <li
              key={s.label}
              className={`rail__step is-${s.state === 'current' ? 'current' : s.state === 'done' ? 'done' : s.state === 'blocked' ? 'blocked' : 'upcoming'}`}
              aria-current={s.state === 'current' ? 'step' : undefined}
            >
              <span className="rail__bar" aria-hidden="true" />
              <span>{s.label}</span>
            </li>
          ))}
        </ol>
      </section>

      <div className="split">
        <div className="stack" style={{ gap: 20 }}>
          <section className="card card__body stack" aria-labelledby="state-heading">
            <h2 id="state-heading">What happens next</h2>
            <p className="small muted">
              Owner: {assigneeName ?? 'nobody yet'} · version {incident.version}
            </p>
            {incident.resolutionNote ? <p className="notice">Resolution: {incident.resolutionNote}</p> : null}
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
            <div className="split-meta">
              <h2 id="reports-heading">Reports ({reports.length})</h2>
              <span className="xs faint">Each person’s report is kept separately</span>
            </div>
            <ul className="list-reset stack" style={{ gap: 10 }}>
              {reports.map((r) => (
                <li key={r.id} className="notice">
                  <div className="xs faint" style={{ marginBottom: 4 }}>
                    {viewerCanOperate ? (reporterNames.get(r.reporterUserId) ?? 'Attendee') : 'Your report'} · {formatUtc(r.createdAt)}
                    {r.matchConfidence < 1 ? ` · matched at ${r.matchConfidence.toFixed(2)}` : ''}
                  </div>
                  <div style={{ color: 'var(--text)' }}>{r.text}</div>
                </li>
              ))}
            </ul>
          </section>
        </div>

        <div className="stack" style={{ gap: 20 }}>
          {viewerCanOperate ? (
            <section className="card card__body stack" aria-labelledby="assign-heading">
              <h2 id="assign-heading">Recommended for this work</h2>
              {recommendations.length === 0 ? (
                <p className="small muted">
                  {incident.assigneeUserId ? 'Already assigned.' : 'No one eligible is recommended for the current status.'}
                </p>
              ) : (
                <ol className="list-reset list-divided">
                  {recommendations.map((r, i) => (
                    <li key={r.membershipId} style={{ padding: '10px 0' }}>
                      <div className="split-meta">
                        <strong>
                          {i + 1}. {r.displayName}
                        </strong>
                        <span className="badge badge--accent">{Math.round(r.total * 100)}%</span>
                      </div>
                      <div className="xs faint" style={{ marginTop: 4 }}>{r.reasons.join(' ')}</div>
                    </li>
                  ))}
                </ol>
              )}
            </section>
          ) : null}

          <section className="card card__body" aria-labelledby="timeline-heading">
            <h2 id="timeline-heading" style={{ marginBottom: 12 }}>Timeline</h2>
            <ol className="timeline">
              {timeline.map((t) => (
                <li key={t.id} className={t.id === timeline.at(-1)?.id ? 'is-current' : undefined}>
                  <div className="small">{t.detail}</div>
                  <div className="timeline__at">{formatUtc(t.at)}</div>
                </li>
              ))}
            </ol>
          </section>
        </div>
      </div>
    </div>
  );
}
