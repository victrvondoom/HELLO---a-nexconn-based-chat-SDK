import Link from 'next/link';
import { NavLinks, type NavLinkItem } from './NavLinks';

interface EventNavProps {
  eventId: string;
  eventName: string;
  displayName: string;
  roleLabel: string;
  operational: boolean;
  canApprove: boolean;
}

/**
 * Navigation is role-aware for presentation only. Each page re-checks the viewer's
 * capability on the server, so a hidden link is never the security control.
 */
export function EventNav({ eventId, eventName, displayName, roleLabel, operational, canApprove }: EventNavProps) {
  const base = `/events/${eventId}`;
  const primary: NavLinkItem[] = [
    { href: `${base}/conversation`, label: 'Conversation', icon: 'conversation' },
    { href: `${base}/incidents`, label: operational ? 'Incidents' : 'My requests', icon: 'incidents' },
    { href: `${base}/sessions`, label: 'Sessions and rooms', icon: 'sessions' },
    { href: `${base}/people`, label: 'People', icon: 'people' },
    { href: `${base}/notifications`, label: 'Notifications', icon: 'bell' },
  ];
  const ops: NavLinkItem[] = operational
    ? [{ href: `${base}/operations`, label: canApprove ? 'Operations and approvals' : 'Operations', icon: 'operations' }]
    : [];

  return (
    <aside className="sidebar" aria-label="Event navigation">
      <Link href={base} className="brand" aria-label="HELLO home">
        <span className="brand__mark" aria-hidden="true">H</span>
        <span>
          HELLO
          <span className="brand__sub">Event coordination</span>
        </span>
      </Link>

      <div className="event-card">
        <strong>{eventName}</strong>
        <span>Demo event · seeded data</span>
      </div>

      <nav aria-label="Primary" className="stack" style={{ gap: 2 }}>
        <NavLinks items={primary} />
        {ops.length > 0 ? <div className="nav-group">Operations</div> : null}
        <NavLinks items={ops} />
      </nav>

      <nav aria-label="Account" className="stack" style={{ gap: 2, marginTop: 8 }}>
        <div className="nav-group">Account</div>
        <NavLinks items={[{ href: `${base}/settings`, label: 'Settings', icon: 'settings' }]} />
      </nav>

      <div className="nav-foot">
        <strong>{displayName}</strong>
        <span className="faint">{roleLabel}</span>
      </div>
    </aside>
  );
}
