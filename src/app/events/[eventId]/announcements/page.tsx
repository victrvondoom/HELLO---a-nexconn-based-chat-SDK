import { loadEventViewer } from '@/lib/viewer';
import { listAnnouncementsFor } from '@/services/workplace';
import { listApprovalsForViewer } from '@/services/approvals';
import { AnnouncementForm } from '@/components/workplace/AnnouncementForm';
import { formatUtc, minutesAgo } from '@/components/ui/labels';
import { LiveRefresh } from '@/components/workplace/LiveRefresh';

export const dynamic = 'force-dynamic';

export default async function AnnouncementsPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  const viewer = await loadEventViewer(eventId);
  const now = viewer.ctx.now();
  const published = await listAnnouncementsFor(viewer.ctx, eventId, viewer.userId);
  const canRequest = viewer.can('approval.request');
  const pending = canRequest
    ? (await listApprovalsForViewer(viewer.ctx, eventId, viewer.userId)).filter(
        (a) => a.actionType === 'PUBLISH_ANNOUNCEMENT' && a.status === 'PENDING',
      )
    : [];
  const names = new Map<string, string>();
  for (const a of published) {
    if (!names.has(a.publishedByUserId)) {
      names.set(a.publishedByUserId, (await viewer.store.getUser(a.publishedByUserId))?.displayName ?? 'Organiser');
    }
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Announcements</h1>
          <p>Published by organisers. Nothing appears here until a second organiser approves it.</p>
        </div>
        <LiveRefresh seconds={20} />
      </div>

      <div className="split">
        <section className="stack" style={{ gap: 12 }} aria-labelledby="published-heading">
          <h2 id="published-heading" className="visually-hidden">Published</h2>
          {published.length === 0 ? (
            <div className="empty">
              <strong>No announcements yet</strong>
              <span>Organisers publish updates for everyone here.</span>
            </div>
          ) : (
            published.map((a) => (
              <article key={a.id} className="card card--raised">
                <div className="card__body stack" style={{ gap: 6 }}>
                  <div className="split-meta">
                    <strong style={{ fontSize: 15 }}>{a.title}</strong>
                    <span className="xs faint" title={formatUtc(a.publishedAt)}>
                      {names.get(a.publishedByUserId)} · {minutesAgo(now, a.publishedAt)}
                    </span>
                  </div>
                  <p className="muted" style={{ whiteSpace: 'pre-wrap' }}>{a.body}</p>
                </div>
              </article>
            ))
          )}
        </section>

        <aside className="stack" style={{ gap: 16 }} aria-label="Propose an announcement">
          {canRequest ? (
            <section className="card card__body stack">
              <h2>Propose an announcement</h2>
              <p className="small muted">Another organiser must approve it before it is published.</p>
              <AnnouncementForm eventId={eventId} />
            </section>
          ) : null}
          {pending.length > 0 ? (
            <section className="card card__body stack">
              <h2>Waiting for approval</h2>
              <ul className="list-reset list-divided small">
                {pending.map((p) => (
                  <li key={p.id}>
                    <strong>{p.payload.title ?? 'Announcement'}</strong>
                    <div className="xs faint">Expires {formatUtc(p.expiresAt)}</div>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
