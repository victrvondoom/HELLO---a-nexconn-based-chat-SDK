import Link from 'next/link';
import { loadEventViewer } from '@/lib/viewer';
import { happeningNow } from '@/services/live-room';
import { LiveRefresh } from '@/components/workplace/LiveRefresh';
import { Icon } from '@/components/ui/Icon';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Live' };

const clock = (ms: number) => new Date(ms).toISOString().slice(11, 16);

/** Live: the rooms running now, and what starts next. A room's QR code opens its live room directly. */
export default async function NowPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  const viewer = await loadEventViewer(eventId);
  const data = await happeningNow(viewer.ctx, eventId, viewer.userId);
  const base = `/events/${eventId}`;
  return (
    <div className="page now">
      <LiveRefresh seconds={30} />
      <h1 className="discover__title">Live</h1>
      {data.live.length === 0 ? (
        <p className="muted">Nothing is running right now.</p>
      ) : (
        <ul className="list-reset now__live">
          {data.live.map((s) => (
            <li key={s.id}>
              <Link href={`${base}/now/${s.id}`} className="card card--interactive now__room">
                <span className="live" aria-hidden="true">
                  <span className="live__dot" />
                </span>
                <span className="grow">
                  <strong>{s.title}</strong>
                  <span className="xs faint">
                    {s.room} · until {clock(s.endsAt)} UTC{s.planned ? ' · in your plan' : ''}
                  </span>
                </span>
                <Icon name="arrow" size={18} />
              </Link>
            </li>
          ))}
        </ul>
      )}
      <p className="eyebrow" style={{ marginTop: 24 }}>Next</p>
      <ul className="list-reset list-divided">
        {data.next.map((s) => (
          <li key={s.id} className="discover__session">
            <span className="today__time">{clock(s.startsAt)}</span>
            <span className="grow">
              <Link href={`${base}/now/${s.id}`}>{s.title}</Link>
              <span className="xs faint"> · {s.room}{s.planned ? ' · in your plan' : ''}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
