import Link from 'next/link';
import { loadEventViewer } from '@/lib/viewer';
import { searchEvent } from '@/services/search';
import { getPlan } from '@/services/live-room';
import { buildNav } from '@/components/layout/nav-model';
import { Icon } from '@/components/ui/Icon';
import { PlanToggle } from '@/components/companion/PlanToggle';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Explore' };

const clock = (ms: number) => new Date(ms).toISOString().slice(11, 16);
const KIND_LABEL: Record<string, string> = { person: 'People', session: 'Sessions', room: 'Rooms', request: 'Your requests', mission: 'Missions', community: 'Communities', post: 'Moments', guide: 'Guide', announcement: 'Announcements', messages: 'Messages' };

/**
 * Explore: one search for sessions, people, rooms, topics and guides; the programme; and every other place
 * in HELLO, one tap away. Opening a result goes to its own page; nothing here needs a new section.
 */
export default async function ExplorePage({ params, searchParams }: { params: Promise<{ eventId: string }>; searchParams: Promise<{ q?: string }> }) {
  const { eventId } = await params;
  const q = ((await searchParams).q ?? '').slice(0, 120);
  const viewer = await loadEventViewer(eventId);
  const base = `/events/${eventId}`;
  const now = viewer.ctx.now();
  const [results, sessions, rooms, plan] = await Promise.all([
    q.trim() ? searchEvent(viewer.ctx, eventId, viewer.userId, q) : Promise.resolve(null),
    viewer.store.listSessions(eventId),
    viewer.store.listRooms(eventId),
    getPlan(viewer.ctx, eventId, viewer.userId),
  ]);
  const roomName = new Map(rooms.map((r) => [r.id, r.name] as const));
  const upcoming = sessions.filter((s) => s.endsAt > now).sort((a, b) => a.startsAt - b.startsAt);
  const topics = [...new Set(sessions.flatMap((s) => s.topics))].sort();
  const groups = results ? [...new Set(results.hits.map((h) => h.kind))] : [];
  const nav = buildNav({
    eventId,
    operational: viewer.can('incident.read.operational'),
    canApprove: viewer.can('approval.decide'),
    canAudit: viewer.can('audit.read'),
    canManageAtlas: viewer.can('field.manage') || viewer.can('field.review'),
    unread: 0,
  });

  return (
    <div className="page discover">
      <form className="discover__search" role="search" action={`${base}/explore`}>
        <Icon name="search" size={20} />
        <input name="q" defaultValue={q} placeholder="Sessions, people, topics, rooms…" aria-label="Search the event" autoComplete="off" />
        <button type="submit" className="button button--sm">
          Search
        </button>
      </form>

      {results ? (
        <section aria-labelledby="results-heading" className="stack" style={{ gap: 16 }}>
          <h1 id="results-heading" className="discover__title">
            {results.hits.length === 0 ? `Nothing found for “${results.query}”` : `Results for “${results.query}”`}
          </h1>
          {groups.map((kind) => (
            <div key={kind} className="card card__body stack" style={{ gap: 8 }}>
              <p className="eyebrow">{KIND_LABEL[kind] ?? kind}</p>
              <ul className="list-reset list-divided">
                {results.hits
                  .filter((h) => h.kind === kind)
                  .map((h) => (
                    <li key={`${h.kind}:${h.id}`} style={{ padding: '8px 0' }}>
                      <Link href={h.href}>{h.title}</Link>
                      <div className="xs faint">{h.detail}</div>
                    </li>
                  ))}
              </ul>
            </div>
          ))}
        </section>
      ) : (
        <>
          <section aria-labelledby="programme-heading" className="card card__body stack" style={{ gap: 8 }}>
            <div className="split-meta">
              <h1 id="programme-heading" className="discover__title">Programme</h1>
              <Link className="small" href={`${base}/sessions`}>
                Full schedule
              </Link>
            </div>
            <ul className="list-reset list-divided">
              {upcoming.map((s) => (
                <li key={s.id} className="discover__session">
                  <span className="today__time">{clock(s.startsAt)}</span>
                  <span className="grow">
                    <Link href={`${base}/now/${s.id}`}>{s.title}</Link>
                    <span className="xs faint"> · {roomName.get(s.roomId)} · {s.enrolled}/{s.capacity}{s.accessible ? ' · step-free' : ''}</span>
                  </span>
                  <PlanToggle eventId={eventId} sessionId={s.id} planned={plan.sessionIds.includes(s.id)} compact />
                </li>
              ))}
            </ul>
          </section>

          <section aria-labelledby="topics-heading" className="stack" style={{ gap: 8 }}>
            <p id="topics-heading" className="eyebrow">Topics</p>
            <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
              {topics.map((t) => (
                <Link key={t} className="chip" href={`${base}/explore?q=${encodeURIComponent(t)}`}>
                  {t}
                </Link>
              ))}
            </div>
          </section>

          <section aria-labelledby="everything-heading" className="stack" style={{ gap: 8 }}>
            <p id="everything-heading" className="eyebrow">Everything at this event</p>
            <div className="discover__tiles">
              {[nav.kingdom, ...nav.more].map((item) => (
                <Link key={item.href} href={item.href} className="discover__tile">
                  <Icon name={item.icon} size={20} />
                  <span>{item.label}</span>
                </Link>
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
