import Link from 'next/link';
import { NavLinks, type NavLinkItem } from './NavLinks';
import { HaloMark, Wordmark } from '@/components/brand/Wordmark';

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
    { href: base, label: 'Today', icon: 'home', exact: true },
    { href: `${base}/conversation`, label: 'Conversation', icon: 'conversation' },
    { href: `${base}/incidents`, label: props.operational ? 'Incidents' : 'My requests', icon: 'incidents' },
    { href: `${base}/announcements`, label: 'Announcements', icon: 'megaphone' },
    { href: `${base}/map`, label: 'Venue map', icon: 'map' },
    { href: `${base}/sessions`, label: 'Sessions and rooms', icon: 'sessions' },
    { href: `${base}/people`, label: 'People', icon: 'people' },
    { href: `${base}/messages`, label: 'Private messages', icon: 'lock' },
    { href: `${base}/notifications`, label: 'Notifications', icon: 'bell', count: props.unread },
  ];
  const ops: NavLinkItem[] = props.operational
    ? [
        { href: `${base}/operations`, label: props.canApprove ? 'Operations and approvals' : 'Operations', icon: 'operations' },
        { href: `${base}/team`, label: 'Team', icon: 'team' },
        { href: `${base}/agents`, label: 'Agent mesh', icon: 'agents' },
      ]
    : [];
  const governance: NavLinkItem[] = props.canAudit ? [{ href: `${base}/audit`, label: 'Audit trail', icon: 'shield' }] : [];

  return (
    <aside className="sidebar" aria-label="Event navigation">
      <Link href={base} className="brand" aria-label="HELLO home">
        <HaloMark size={34} />
        <span className="brand__text">
          <Wordmark height={26} id="wm-nav" title="HELLO" />
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
        <span className="nav-foot__avatar" aria-hidden="true">
          {initials(props.displayName)}
        </span>
        <span style={{ minWidth: 0 }}>
          <strong>{props.displayName}</strong>
          <span className="faint xs">{props.roleLabel}</span>
        </span>
      </div>
    </aside>
  );
}

function initials(name: string): string {
  return name
    .replace(/\(.*?\)/g, '')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p.charAt(0).toUpperCase())
    .join('');
}
