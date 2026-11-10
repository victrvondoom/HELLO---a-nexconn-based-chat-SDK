import Link from 'next/link';
import { loadEventViewer } from '@/lib/viewer';
import { listIncidentsForViewer } from '@/services/incidents';
import { slaFor } from '@/domain/incidents/sla';
import { CATEGORY_LABEL, STATUS_LABEL } from '@/domain/labels';
import { minutesAgo, URGENCY_LABEL } from '@/components/ui/labels';
import { IncidentBadge } from '@/components/incidents/IncidentBadge';
import { SlaChip } from '@/components/workplace/SlaChip';
import { LiveRefresh } from '@/components/workplace/LiveRefresh';

export const dynamic = 'force-dynamic';

const FILTERS = [
  { key: 'open', label: 'Open' },
  { key: 'attention', label: 'Needs attention' },
  { key: 'closed', label: 'Closed' },
  { key: 'all', label: 'All' },
] as const;
type Filter = (typeof FILTERS)[number]['key'];

export default async function IncidentsPage({
  params,
  searchParams,
}: {
  params: Promise<{ eventId: string }>;
  searchParams: Promise<{ filter?: string; q?: string }>;
}) {
  const { eventId } = await params;
  const { filter: rawFilter, q } = await searchParams;
  const viewer = await loadEventViewer(eventId);
  const filter: Filter = FILTERS.some((f) => f.key === rawFilter) ? (rawFilter as Filter) : 'open';
  const operational = viewer.can('incident.read.operational');
  const now = viewer.ctx.now();
  const term = (q ?? '').trim().toLowerCase();

  const all = await listIncidentsForViewer(viewer.ctx, eventId, viewer.userId);
  const rows = all
    .map((row) => ({ ...row, sla: slaFor(row.incident, now) }))
    .filter(({ incident, sla }) => {
      const closed = ['CLOSED', 'CANCELLED', 'CONFIRMED'].includes(incident.status);
      if (filter === 'open' && closed) return false;
      if (filter === 'closed' && !closed) return false;
      if (filter === 'attention' && !(sla.state === 'BREACHED' || sla.state === 'AT_RISK' || incident.status === 'NEEDS_INFORMATION')) return false;
      if (term && !`${incident.title} ${incident.category} ${STATUS_LABEL[incident.status]}`.toLowerCase().includes(term)) return false;
      return true;
    });

  const counts = {
    open: all.filter((r) => !['CLOSED', 'CANCELLED', 'CONFIRMED'].includes(r.incident.status)).length,
    attention: all.filter((r) => slaFor(r.incident, now).state === 'BREACHED' || slaFor(r.incident, now).state === 'AT_RISK').length,
  };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>{operational ? 'Incidents' : 'My requests'}</h1>
          <p>
            {operational
              ? 'Every incident in this event, with its acknowledgement timer and owner.'
              : 'Reports you have made. You are told when their status changes.'}
          </p>
        </div>
        <LiveRefresh seconds={8} />
      </div>

      <div className="split-meta" style={{ marginBottom: 16 }}>
        <nav className="row" aria-label="Filter incidents">
          {FILTERS.map((f) => (
            <Link key={f.key} href={`?filter=${f.key}${term ? `&q=${encodeURIComponent(term)}` : ''}`} className={f.key === filter ? 'chip chip--active' : 'chip'}>
              {f.label}
              {f.key === 'open' ? ` · ${counts.open}` : ''}
              {f.key === 'attention' && counts.attention > 0 ? ` · ${counts.attention}` : ''}
            </Link>
          ))}
        </nav>
        <form role="search" method="get" className="row">
          <input type="hidden" name="filter" value={filter} />
          <label htmlFor="incident-q" className="visually-hidden">Search incidents</label>
          <input id="incident-q" name="q" defaultValue={term} placeholder="Search title, category, status" style={{ width: 240 }} />
        </form>
      </div>

      {rows.length === 0 ? (
        <div className="empty">
          <strong>{term ? 'No incidents match that search' : 'Nothing to show here'}</strong>
          <span>
            {operational
              ? 'Incidents appear as soon as someone reports a problem.'
              : 'Report a problem in the conversation and it will appear here.'}
          </span>
        </div>
      ) : (
        <div className="card" style={{ overflow: 'hidden' }}>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">Incident</th>
                  <th scope="col">Status</th>
                  {operational ? <th scope="col">Acknowledgement</th> : null}
                  <th scope="col">Urgency</th>
                  <th scope="col">Reports</th>
                  <th scope="col">Updated</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ incident, reportCount, sla }) => (
                  <tr key={incident.id}>
                    <td>
                      <Link href={`/events/${eventId}/incidents/${incident.id}`}>{incident.title}</Link>
                      <div className="xs faint">{CATEGORY_LABEL[incident.category]}</div>
                    </td>
                    <td>
                      <IncidentBadge status={incident.status} />
                      <div className="xs faint">{STATUS_LABEL[incident.status]}</div>
                    </td>
                    {operational ? <td><SlaChip sla={sla} /></td> : null}
                    <td className="small">{URGENCY_LABEL[incident.urgency]}</td>
                    <td className="small">{reportCount}</td>
                    <td className="small faint">{minutesAgo(now, incident.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
