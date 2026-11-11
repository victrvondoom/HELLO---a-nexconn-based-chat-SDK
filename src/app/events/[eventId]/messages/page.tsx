import Link from 'next/link';
import { loadEventViewer } from '@/lib/viewer';
import { inbox } from '@/services/private-messages';
import { Avatar } from '@/components/social/Avatar';
import { Icon } from '@/components/ui/Icon';
import { formatUtc } from '@/components/ui/labels';

export const dynamic = 'force-dynamic';

export default async function MessagesPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  const viewer = await loadEventViewer(eventId);
  const rows = await inbox(viewer.ctx, eventId, viewer.userId);

  return (
    <div className="page" style={{ maxWidth: 880 }}>
      <div className="page-header">
        <div>
          <p className="eyebrow">End-to-end encrypted</p>
          <h1>Private messages</h1>
          <p>Between you and your connections only. Messages are sealed on your device; HELLO stores text it cannot read.</p>
        </div>
      </div>

      <div className="two-planes" role="note">
        <div>
          <span className="plane-tag plane-tag--open">HELLO conversation</span>
          <p className="small muted">Read by HELLO’s agents and event staff, because they have to read a report to act on it.</p>
        </div>
        <div>
          <span className="plane-tag plane-tag--sealed">
            <Icon name="lock" size={12} /> Private messages
          </span>
          <p className="small muted">Read only by the two of you. Not by HELLO, not by staff, not by organisers.</p>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="empty card">
          <Icon name="lock" size={22} />
          <strong>No connections yet</strong>
          <span>
            Private messages open when two people follow each other. <Link href={`/events/${eventId}/people`}>Find people</Link>
          </span>
        </div>
      ) : (
        <ul className="list-reset inbox">
          {rows.map((r) => (
            <li key={r.peerId}>
              <Link href={`/events/${eventId}/messages/${r.peerId}`} className="inbox__row">
                <Avatar name={r.displayName} size={44} ring />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <strong>{r.displayName}</strong>
                  <span className="xs faint" style={{ display: 'block' }}>
                    {r.count === 0 ? 'Connected · no messages yet' : `${r.count} encrypted message${r.count === 1 ? '' : 's'}`}
                  </span>
                </span>
                <span className="xs faint">{r.lastAt ? formatUtc(r.lastAt).slice(11) : ''}</span>
                <Icon name="arrow" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
