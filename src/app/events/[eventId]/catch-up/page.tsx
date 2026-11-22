import Link from 'next/link';
import { cookies } from 'next/headers';
import { loadEventViewer } from '@/lib/viewer';
import { catchUpFor } from '@/services/catchup';
import { parseLastSeen, seenCookieName } from '@/domain/catchup/window';
import { formatUtc, minutesAgo } from '@/components/ui/labels';
import { CaughtUpButton } from '@/components/workplace/CaughtUpButton';
import { LiveRefresh } from '@/components/workplace/LiveRefresh';

export const dynamic = 'force-dynamic';

export default async function CatchUpPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  const viewer = await loadEventViewer(eventId);
  const now = viewer.ctx.now();
  const lastSeen = parseLastSeen((await cookies()).get(seenCookieName(eventId))?.value, now);
  const result = await catchUpFor(viewer.ctx, eventId, viewer.userId, lastSeen);

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>What is new</h1>
          <p>{result.headline}</p>
          {result.since !== null ? <p className="xs faint">Since {formatUtc(result.since)}. Kept in this browser only.</p> : null}
        </div>
        <div className="row">
          <LiveRefresh seconds={15} />
          <CaughtUpButton eventId={eventId} />
        </div>
      </div>

      {result.notifications.length > 0 ? (
        <section className="stack" style={{ gap: 10 }}>
          <h2>For you</h2>
          <ul className="list-reset stack" style={{ gap: 10 }}>
            {result.notifications.map((n) => (
              <li key={n.id} className="card">
                <div className="card__body stack" style={{ gap: 6 }}>
                  <span className="xs faint">{minutesAgo(now, n.createdAt)}</span>
                  <p>{n.body}</p>
                  <div>
                    <Link href={n.href}>Open</Link>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {result.posts.length > 0 ? (
        <section className="stack" style={{ gap: 10 }}>
          <h2>New posts</h2>
          <ul className="list-reset stack" style={{ gap: 10 }}>
            {result.posts.map((p) => (
              <li key={p.id} className="card">
                <div className="card__body stack" style={{ gap: 6 }}>
                  <span className="xs faint">
                    {p.author.name} · {minutesAgo(now, p.createdAt)}
                  </span>
                  <p>{p.text}</p>
                </div>
              </li>
            ))}
          </ul>
          <Link href={`/events/${eventId}/feed`}>Open the feed</Link>
        </section>
      ) : null}
    </div>
  );
}
