import Link from 'next/link';
import { loadEventViewer } from '@/lib/viewer';
import { listIncidentsForViewer } from '@/services/incidents';
import { listSlaBoard, listAnnouncementsFor, notificationFeed } from '@/services/workplace';
import { STATUS_LABEL } from '@/domain/labels';
import { formatUtc, minutesAgo } from '@/components/ui/labels';
import { IncidentBadge } from '@/components/incidents/IncidentBadge';
import { SlaChip } from '@/components/workplace/SlaChip';
import { LiveRefresh } from '@/components/workplace/LiveRefresh';

export const dynamic = 'force-dynamic';

function greeting(hour: number): string {
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

/** "Today": what matters to this person right now. Every figure is computed on request. */
export default async function TodayPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  const viewer = await loadEventViewer(eventId);
  const now = viewer.ctx.now();
  const operational = viewer.can('incident.read.operational');
  const firstName = (viewer.user?.displayName ?? 'there').replace(/\s*\(.*\)$/, '').split(' ')[0];

  const [mine, feed, announcements, sessions, rooms] = await Promise.all([
    listIncidentsForViewer(viewer.ctx, eventId, viewer.userId),
    notificationFeed(viewer.ctx, eventId, viewer.userId),
    listAnnouncementsFor(viewer.ctx, eventId, viewer.userId),
    viewer.store.listSessions(eventId),
    viewer.store.listRooms(eventId),
  ]);
  const roomName = new Map(rooms.map((r) => [r.id, r.name] as const));
  const upcoming = sessions
    .filter((s) => s.endsAt > now)
    .sort((a, b) => a.startsAt - b.startsAt)
    .slice(0, 3);
  const openMine = mine.filter((r) => !['CLOSED', 'CANCELLED', 'CONFIRMED'].includes(r.incident.status));
  const hour = new Date(now).getUTCHours();

  const assigned = operational
    ? (await viewer.store.listIncidents(eventId)).filter((i) => i.assigneeUserId === viewer.userId && !['CLOSED', 'CANCELLED', 'CONFIRMED'].includes(i.status))
    : [];
  const board = operational ? await listSlaBoard(viewer.ctx, eventId, viewer.userId) : [];
  const overdue = board.filter((r) => r.sla.state === 'BREACHED');

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>
            {greeting(hour)}, {firstName}
          </h1>
          <p>
            {operational
              ? `${board.length} open incidents${overdue.length > 0 ? `, ${overdue.length} past their target` : ''}.`
              : openMine.length > 0
                ? `${openMine.length} of your requests ${openMine.length === 1 ? 'is' : 'are'} still open.`
                : 'Nothing open for you right now.'}
          </p>
        </div>
        <LiveRefresh seconds={10} />
      </div>

      <div className="kpi-grid" style={{ marginBottom: 20 }}>
        {operational ? (
          <>
            <Kpi value={board.length} label="Open incidents" href={`/events/${eventId}/operations`} />
            <Kpi value={overdue.length} label="Past target" href={`/events/${eventId}/operations`} tone={overdue.length > 0 ? 'danger' : undefined} />
            <Kpi value={assigned.length} label="Assigned to you" href={`/events/${eventId}/incidents`} />
          </>
        ) : (
          <>
            <Kpi value={openMine.length} label="Open requests" href={`/events/${eventId}/incidents`} />
            <Kpi value={upcoming.length} label="Upcoming sessions" href={`/events/${eventId}/sessions`} />
          </>
        )}
        <Kpi value={feed.unread} label="Unread updates" href={`/events/${eventId}/notifications`} tone={feed.unread > 0 ? 'accent' : undefined} />
      </div>

      <div className="split">
        <div className="stack" style={{ gap: 20 }}>
          <section className="card card__body stack" aria-labelledby="today-requests">
            <div className="split-meta">
              <h2 id="today-requests">{operational ? 'Needs you' : 'Your requests'}</h2>
              <Link className="small" href={`/events/${eventId}/incidents`}>See all</Link>
            </div>
            {operational ? (
              board.slice(0, 4).length === 0 ? (
                <p className="small muted">Nothing is waiting on the team.</p>
              ) : (
                <ul className="list-reset list-divided">
                  {board.slice(0, 4).map(({ incident, sla }) => (
                    <li key={incident.id} className="split-meta" style={{ padding: '10px 0' }}>
                      <div>
                        <Link href={`/events/${eventId}/incidents/${incident.id}`}>{incident.title}</Link>
                        <div className="xs faint">{STATUS_LABEL[incident.status]}</div>
                      </div>
                      <SlaChip sla={sla} />
                    </li>
                  ))}
                </ul>
              )
            ) : openMine.length === 0 ? (
              <p className="small muted">You have nothing open. Report a problem in the conversation whenever you need one.</p>
            ) : (
              <ul className="list-reset list-divided">
                {openMine.slice(0, 4).map(({ incident }) => (
                  <li key={incident.id} className="split-meta" style={{ padding: '10px 0' }}>
                    <div>
                      <Link href={`/events/${eventId}/incidents/${incident.id}`}>{incident.title}</Link>
                      <div className="xs faint">{STATUS_LABEL[incident.status]} · {minutesAgo(now, incident.updatedAt)}</div>
                    </div>
                    <IncidentBadge status={incident.status} />
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="card card__body stack" aria-labelledby="today-latest">
            <div className="split-meta">
              <h2 id="today-latest">Latest announcement</h2>
              <Link className="small" href={`/events/${eventId}/announcements`}>All announcements</Link>
            </div>
            {announcements[0] ? (
              <div className="stack" style={{ gap: 4 }}>
                <strong>{announcements[0].title}</strong>
                <p className="small muted">{announcements[0].body}</p>
                <span className="xs faint">Published {minutesAgo(now, announcements[0].publishedAt)}</span>
              </div>
            ) : (
              <p className="small muted">No announcements have been published yet.</p>
            )}
          </section>
        </div>

        <section className="card card__body stack" aria-labelledby="today-next">
          <div className="split-meta">
            <h2 id="today-next">Next up</h2>
            <Link className="small" href={`/events/${eventId}/sessions`}>Schedule</Link>
          </div>
          {upcoming.length === 0 ? (
            <p className="small muted">No more sessions today.</p>
          ) : (
            <ol className="list-reset list-divided">
              {upcoming.map((s) => {
                const startsIn = Math.round((s.startsAt - now) / 60000);
                return (
                  <li key={s.id} style={{ padding: '10px 0' }}>
                    <strong>{s.title}</strong>
                    <div className="xs faint">
                      {roomName.get(s.roomId)} · {formatUtc(s.startsAt).slice(11)}
                      {startsIn > 0 ? ` · in ${startsIn} min` : ' · starting now'}
                    </div>
                    <div className="xs faint">
                      {s.enrolled}/{s.capacity} enrolled
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </section>
      </div>
    </div>
  );
}

function Kpi({ value, label, href, tone }: { value: number; label: string; href: string; tone?: 'danger' | 'accent' }) {
  const color = tone === 'danger' ? 'var(--danger)' : tone === 'accent' ? 'var(--accent)' : undefined;
  return (
    <Link href={href} className="card card--interactive kpi" style={{ textDecoration: 'none', color: 'inherit' }}>
      <span className="kpi__value" style={{ color }}>{value}</span>
      <span className="kpi__label">{label}</span>
    </Link>
  );
}
