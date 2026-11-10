import Link from 'next/link';
import { loadEventViewer } from '@/lib/viewer';
import { notificationFeed } from '@/services/workplace';
import { formatUtc, minutesAgo } from '@/components/ui/labels';
import { MarkAllReadButton } from '@/components/workplace/MarkAllReadButton';
import { LiveRefresh } from '@/components/workplace/LiveRefresh';

export const dynamic = 'force-dynamic';

export default async function NotificationsPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  const viewer = await loadEventViewer(eventId);
  const feed = await notificationFeed(viewer.ctx, eventId, viewer.userId);
  const now = viewer.ctx.now();

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Notifications</h1>
          <p>
            {feed.unread > 0 ? `${feed.unread} unread.` : 'You are up to date.'} Each update is sent once, when the change is recorded.
          </p>
        </div>
        <div className="row">
          <LiveRefresh seconds={10} />
          <MarkAllReadButton eventId={eventId} unread={feed.unread} />
        </div>
      </div>

      {feed.items.length === 0 ? (
        <div className="empty">
          <strong>No notifications yet</strong>
          <span>When the status of something you reported changes, it will appear here.</span>
        </div>
      ) : (
        <ul className="list-reset stack" style={{ gap: 10 }}>
          {feed.items.map((n) => (
            <li key={n.id} className={n.readAt === null ? 'card card--raised is-unread' : 'card muted-row'}>
              <div className="card__body stack" style={{ gap: 6 }}>
                <div className="split-meta">
                  <span className="xs faint" title={formatUtc(n.createdAt)}>
                    {n.kind.replace(/_/g, ' ').toLowerCase()} · {minutesAgo(now, n.createdAt)}
                  </span>
                  {n.readAt === null ? <span className="badge badge--accent">New</span> : null}
                </div>
                <p>{n.body}</p>
                <div>
                  <Link href={n.href}>Open</Link>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
