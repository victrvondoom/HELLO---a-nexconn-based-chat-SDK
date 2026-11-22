import Link from 'next/link';
import { loadEventViewer } from '@/lib/viewer';
import { listSlaBoard } from '@/services/workplace';
import { planB, todaySummary } from '@/services/live-room';
import { Icon } from '@/components/ui/Icon';
import { LiveRefresh } from '@/components/workplace/LiveRefresh';
import { PlanToggle } from '@/components/companion/PlanToggle';
import { HoldSeat } from '@/components/companion/HoldSeat';
import { Medallion } from '@/components/brand/Motifs';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Today' };

const clock = (ms: number) => `${new Date(ms).toISOString().slice(11, 16)} UTC`;

function greeting(hour: number): string {
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

function until(now: number, at: number): string {
  const m = Math.round((at - now) / 60000);
  if (m <= 0) return 'happening now';
  if (m < 60) return `starts in ${m} min`;
  return `starts in ${Math.floor(m / 60)} h ${m % 60} min`;
}

/**
 * Today: what matters now, in priority order. The next session, changes to your plan, a Plan B if your
 * session is full, someone worth meeting, and one-tap help. Everything else is one tap away elsewhere.
 */
export default async function TodayPage({ params, searchParams }: { params: Promise<{ eventId: string }>; searchParams: Promise<{ planb?: string }> }) {
  const { eventId } = await params;
  const { planb: replacing } = await searchParams;
  const viewer = await loadEventViewer(eventId);
  const base = `/events/${eventId}`;
  const today = await todaySummary(viewer.ctx, eventId, viewer.userId);
  const now = today.now;
  const firstName = (viewer.user?.displayName ?? 'there').replace(/\s*\(.*\)$/, '').split(' ')[0];
  const operational = viewer.can('incident.read.operational');
  const board = operational ? await listSlaBoard(viewer.ctx, eventId, viewer.userId) : [];
  const overdue = board.filter((r) => r.sla.state === 'BREACHED').length;
  // A room-full QR lands here with ?planb=<session>: show that person's own best alternatives.
  const rescue = replacing ? await planB(viewer.ctx, eventId, viewer.userId, replacing) : null;
  const holdFor = (sessionId: string) => rescue?.holds.find((h) => h.sessionId === sessionId)?.expiresAt ?? null;

  return (
    <div className="page today">
      <LiveRefresh seconds={20} />
      <header className="today__head">
        <h1>
          {greeting(new Date(now).getUTCHours())}, {firstName}
        </h1>
        {operational ? (
          <Link href={`${base}/operations`} className="today__ops">
            {board.length} open {board.length === 1 ? 'incident' : 'incidents'}
            {overdue > 0 ? `, ${overdue} past target` : ''} <Icon name="arrow" size={14} />
          </Link>
        ) : null}
      </header>

      {rescue ? (
        <section className="card card__body today__card today__card--alert" aria-labelledby="planb-heading">
          <p className="eyebrow">Plan B</p>
          <h2 id="planb-heading">{rescue.replacing ? `${rescue.replacing.title} is full` : 'Alternatives'}</h2>
          {rescue.options.length === 0 ? (
            <p className="small muted">Nothing suitable starts in the next 90 minutes. The quiet room and the help desk are always open.</p>
          ) : (
            <ul className="list-reset today__options">
              {rescue.options.map((o) => (
                <li key={o.sessionId}>
                  <div>
                    <strong>{o.title}</strong>
                    <div className="xs faint">{o.roomName} · {o.reasons.join(' · ')}</div>
                  </div>
                  <HoldSeat eventId={eventId} sessionId={o.sessionId} heldUntil={holdFor(o.sessionId)} />
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      <div className="today__grid">
        {today.next ? (
          <section className="card card__body today__card today__card--next" aria-labelledby="next-heading">
            <p className="eyebrow">Your next session</p>
            <h2 id="next-heading">{today.next.title}</h2>
            <p className="today__meta">
              {today.next.room} · {clock(today.next.startsAt)} · {until(now, today.next.startsAt)}
            </p>
            <div className="row" style={{ gap: 8 }}>
              <Link className="button button--sm" href={`${base}/now/${today.next.id}`}>
                <Icon name="mic" size={14} /> Open the room
              </Link>
              {today.next.full ? (
                <Link className="button button--sm button--ghost" href={`${base}?planb=${today.next.id}`}>
                  It is full: show Plan B
                </Link>
              ) : null}
            </div>
            {today.alternative && !rescue ? (
              <p className="small today__planb">
                <strong>Suggested Plan B:</strong> {today.alternative.title} — {today.alternative.reasons.join(', ')}.
              </p>
            ) : null}
          </section>
        ) : (
          <section className="card card__body today__card today__card--next" aria-labelledby="plan-heading">
            <p className="eyebrow">Your plan</p>
            <h2 id="plan-heading">Pick what you want to see</h2>
            {today.suggestions.length === 0 ? (
              <p className="small muted">No more sessions today.</p>
            ) : (
              <ul className="list-reset today__options">
                {today.suggestions.map((s) => (
                  <li key={s.id}>
                    <div>
                      <strong>{s.title}</strong>
                      <div className="xs faint">{s.room} · {clock(s.startsAt)}</div>
                    </div>
                    <PlanToggle eventId={eventId} sessionId={s.id} planned={false} compact />
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        <Link href={`${base}/kingdom/world`} className="kingdom-hero" aria-label="Enter your Kingdom in 3D">
          <Medallion size={72} />
          <span>
            <span className="eyebrow">Your Kingdom</span>
            <strong>Step inside, in 3D</strong>
            <span className="small">Walk your world, meet its citizens, build.</span>
          </span>
          <Icon name="arrow" size={20} />
        </Link>

        {today.changes.length > 0 ? (
          <section className="card card__body today__card" aria-labelledby="changes-heading">
            <p className="eyebrow">Schedule changed</p>
            <h2 id="changes-heading" className="visually-hidden">Schedule changes</h2>
            <ul className="list-reset stack" style={{ gap: 8 }}>
              {today.changes.map((c) => (
                <li key={c.id} className="small">{c.body}</li>
              ))}
            </ul>
          </section>
        ) : null}

        {today.agenda.length > 1 ? (
          <section className="card card__body today__card" aria-labelledby="agenda-heading">
            <p className="eyebrow">Later today</p>
            <h2 id="agenda-heading" className="visually-hidden">Your agenda</h2>
            <ol className="list-reset today__agenda">
              {today.agenda.slice(1).map((s) => (
                <li key={s.id}>
                  <span className="today__time">{clock(s.startsAt).slice(0, 5)}</span>
                  <Link href={`${base}/now/${s.id}`}>{s.title}</Link>
                  <span className="xs faint">{s.room}</span>
                </li>
              ))}
            </ol>
          </section>
        ) : null}

        {today.people.length > 0 ? (
          <section className="card card__body today__card" aria-labelledby="people-heading">
            <p className="eyebrow">Worth meeting</p>
            <h2 id="people-heading" className="visually-hidden">People worth meeting</h2>
            <ul className="list-reset stack" style={{ gap: 10 }}>
              {today.people.map((p) => (
                <li key={p.userId}>
                  <Link href={`${base}/people/${p.userId}`}>
                    <strong>{p.name}</strong>
                  </Link>
                  <div className="xs faint">{p.why}</div>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>

      <nav className="today__quick" aria-label="Quick help">
        <Link href={`${base}/conversation`}>
          <Icon name="incidents" size={20} />
          Report a problem
        </Link>
        {/* A plain link, not client navigation, so the cached care page also opens offline. */}
        <a href={`${base}/care`}>
          <Icon name="heart" size={20} />I need a break
        </a>
        <Link href={`${base}/conversation`}>
          <Icon name="conversation" size={20} />
          Ask for help
        </Link>
        <Link href={`${base}/people`}>
          <Icon name="people" size={20} />
          My connections
        </Link>
      </nav>
    </div>
  );
}
