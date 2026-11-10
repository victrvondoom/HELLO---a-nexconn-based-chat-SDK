import Link from 'next/link';
import { NavLinks, type NavLinkItem } from './NavLinks';

interface EventNavProps {
  eventId: string;
  eventName: string;
  displayName: string;
  roleLabel: string;
  operational: boolean;
  canApprove: boolean;
  canAudit: boolean;
  unread: number;
}

/**
 * Navigation is role-aware for presentation only. Each page re-checks the viewer's
 * capability on the server, so a hidden link is never the security control.
 */
export function EventNav(props: EventNavProps) {
  const base = `/events/${props.eventId}`;
  const primary: NavLinkItem[] = [
    { href: base, label: 'Today', icon: 'home' },
    { href: `${base}/conversation`, label: 'Conversation', icon: 'conversation' },
    { href: `${base}/incidents`, label: props.operational ? 'Incidents' : 'My requests', icon: 'incidents' },
    { href: `${base}/announcements`, label: 'Announcements', icon: 'megaphone' },
    { href: `${base}/sessions`, label: 'Sessions and rooms', icon: 'sessions' },
    { href: `${base}/people`, label: 'People', icon: 'people' },
    { href: `${base}/notifications`, label: 'Notifications', icon: 'bell', count: props.unread },
  ];
  const ops: NavLinkItem[] = props.operational
    ? [
        { href: `${base}/operations`, label: props.canApprove ? 'Operations and approvals' : 'Operations', icon: 'operations' },
        { href: `${base}/team`, label: 'Team', icon: 'team' },
      ]
    : [];
  const governance: NavLinkItem[] = props.canAudit ? [{ href: `${base}/audit`, label: 'Audit trail', icon: 'shield' }] : [];

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
        <strong>{props.eventName}</strong>
        <span>Demo event · seeded data</span>
      </div>

      <nav aria-label="Primary" className="stack" style={{ gap: 2 }}>
        <NavLinks items={primary} />
        {ops.length > 0 ? <div className="nav-group">Operations</div> : null}
        <NavLinks items={ops} />
        {governance.length > 0 ? <div className="nav-group">Governance</div> : null}
        <NavLinks items={governance} />
      </nav>

      <nav aria-label="Account" className="stack" style={{ gap: 2, marginTop: 8 }}>
        <div className="nav-group">Account</div>
        <NavLinks items={[{ href: `${base}/settings`, label: 'Profile and settings', icon: 'settings' }]} />
      </nav>

      <div className="nav-foot">
        <strong>{props.displayName}</strong>
        <span className="faint">{props.roleLabel}</span>
      </div>
    </aside>
  );
}
