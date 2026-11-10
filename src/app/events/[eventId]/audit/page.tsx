import { notFound } from 'next/navigation';
import { loadEventViewer } from '@/lib/viewer';
import { listAuditFor } from '@/services/workplace';
import { DomainError } from '@/domain/errors';
import { formatUtc } from '@/components/ui/labels';
import { LiveRefresh } from '@/components/workplace/LiveRefresh';

export const dynamic = 'force-dynamic';

export default async function AuditPage({
  params,
  searchParams,
}: {
  params: Promise<{ eventId: string }>;
  searchParams: Promise<{ action?: string }>;
}) {
  const { eventId } = await params;
  const { action } = await searchParams;
  const viewer = await loadEventViewer(eventId);
  let entries;
  try {
    entries = await listAuditFor(viewer.ctx, eventId, viewer.userId);
  } catch (error: unknown) {
    if (error instanceof DomainError && error.code === 'FORBIDDEN') notFound();
    throw error;
  }
  const actions = [...new Set(entries.map((e) => e.action))].sort();
  const shown = action ? entries.filter((e) => e.action === action) : entries;
  const names = new Map<string, string>();
  for (const e of shown) {
    if (e.actorUserId && !names.has(e.actorUserId)) {
      names.set(e.actorUserId, (await viewer.store.getUser(e.actorUserId))?.displayName ?? e.actorUserId);
    }
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Audit trail</h1>
          <p>Every consequential action in this event, newest first. Entries cannot be edited.</p>
        </div>
        <LiveRefresh seconds={15} />
      </div>

      <nav className="row" aria-label="Filter by action" style={{ marginBottom: 16 }}>
        <a className={!action ? 'chip chip--active' : 'chip'} href="?">All ({entries.length})</a>
        {actions.map((a) => (
          <a key={a} className={action === a ? 'chip chip--active' : 'chip'} href={`?action=${encodeURIComponent(a)}`}>
            {a}
          </a>
        ))}
      </nav>

      {shown.length === 0 ? (
        <div className="empty">
          <strong>Nothing recorded yet</strong>
          <span>Assignments, approvals, escalations and announcements appear here as they happen.</span>
        </div>
      ) : (
        <div className="card" style={{ overflow: 'hidden' }}>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">When</th>
                  <th scope="col">Who</th>
                  <th scope="col">Action</th>
                  <th scope="col">Detail</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((e) => (
                  <tr key={e.id}>
                    <td className="small faint" style={{ whiteSpace: 'nowrap' }}>{formatUtc(e.at)}</td>
                    <td className="small">{e.actorUserId ? (names.get(e.actorUserId) ?? e.actorUserId) : 'HELLO (automatic)'}</td>
                    <td><span className="mono">{e.action}</span></td>
                    <td className="small">{e.detail}</td>
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
