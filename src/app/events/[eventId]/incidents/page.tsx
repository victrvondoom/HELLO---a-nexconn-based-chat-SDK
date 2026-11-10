import Link from 'next/link';
import { loadEventViewer } from '@/lib/viewer';
import { listIncidentsForViewer } from '@/services/incidents';
import { ROOM_SCOPED } from '@/services/incidents';
import { STATUS_LABEL } from '@/domain/labels';
import { formatUtc, minutesAgo, URGENCY_LABEL } from '@/components/ui/labels';
import { IncidentBadge } from '@/components/incidents/IncidentBadge';

export const dynamic = 'force-dynamic';

const OPEN_FILTER = ['open', 'closed', 'all'] as const;
type Filter = (typeof OPEN_FILTER)[number];

export default async function IncidentsPage({
  params,
  searchParams,
}: {
  params: Promise<{ eventId: string }>;
  searchParams: Promise<{ filter?: string }>;
}) {
  const { eventId } = await params;
  const { filter: rawFilter } = await searchParams;
  const viewer = await loadEventViewer(eventId);
  const filter: Filter = (OPEN_FILTER as readonly string[]).includes(rawFilter ?? '') ? (rawFilter as Filter) : 'open';
  const operational = viewer.can('incident.read.operational');
  const rows = (await listIncidentsForViewer(viewer.ctx, eventId, viewer.userId)).filter((row) => {
    const closed = ['CLOSED', 'CANCELLED', 'CONFIRMED'].includes(row.incident.status);
    if (filter === 'open') return !closed;
    if (filter === 'closed') return closed;
    return true;
  });
  const now = viewer.ctx.now();

  return (
    <>
      <div className="page-header">
        <div>
          <h1>{operational ? 'Incidents' : 'My requests'}</h1>
          <p className="muted small" style={{ margin: 0 }}>
            {operational
              ? 'Every incident in this event, with its current owner and status.'
              : 'Reports you have made, and their status. You are told when something changes.'}
          </p>
        </div>
        <nav className="row" aria-label="Filter incidents">
          {OPEN_FILTER.map((f) => (
            <Link key={f} href={`?filter=${f}`} className={f === filter ? 'badge badge--accent' : 'badge'}>
              {f === 'open' ? 'Open' : f === 'closed' ? 'Closed' : 'All'}
            </Link>
          ))}
        </nav>
      </div>

      {rows.length === 0 ? (
        <div className="empty">
          {operational ? 'No incidents match this filter.' : 'You have not reported anything yet. Use the conversation to tell HELLO what is happening.'}
        </div>
      ) : (
        <div className="table-wrap card card__body" style={{ padding: 0 }}>
          <table>
            <caption className="muted small" style={{ textAlign: 'left', padding: 12 }}>
              {rows.length} incident{rows.length === 1 ? '' : 's'}
            </caption>
            <thead>
              <tr>
                <th scope="col">Incident</th>
                <th scope="col">Status</th>
                <th scope="col">Urgency</th>
                <th scope="col">Reports</th>
                <th scope="col">Updated</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ incident, reportCount }) => (
                <tr key={incident.id}>
                  <td>
                    <Link href={`/events/${eventId}/incidents/${incident.id}`}>{incident.title}</Link>
                    <div className="small muted">
                      {incident.category}
                      {incident.roomId && ROOM_SCOPED.has(incident.category) ? ' · room-specific' : ''}
                    </div>
                  </td>
                  <td>
                    <IncidentBadge status={incident.status} />
                    <div className="small muted">{STATUS_LABEL[incident.status]}</div>
                  </td>
                  <td>{URGENCY_LABEL[incident.urgency]}</td>
                  <td>{reportCount}</td>
                  <td>
                    <span title={formatUtc(incident.updatedAt)}>{minutesAgo(now, incident.updatedAt)}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
