import Link from 'next/link';
import { loadEventViewer } from '@/lib/viewer';
import { formatUtc } from '@/components/ui/labels';

export const dynamic = 'force-dynamic';

export default async function NotificationsPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  const viewer = await loadEventViewer(eventId);
  const notes = (await viewer.store.listNotifications(viewer.userId)).filter((n) => n.eventId === eventId);

  return (
    <>
      <h1>Notifications</h1>
      <p className="muted small">Each update is sent once, when the change is recorded. Follow the link to see the source.</p>
      {notes.length === 0 ? (
        <div className="empty">No notifications yet.</div>
      ) : (
        <ul className="stack" style={{ listStyle: 'none', padding: 0 }}>
          {notes.map((n) => (
            <li key={n.id} className="card card__body stack">
              <div className="small muted">
                {n.kind.replace(/_/g, ' ').toLowerCase()} · {formatUtc(n.createdAt)}
              </div>
              <div>{n.body}</div>
              <div>
                <Link href={n.href}>Open</Link>
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
