import Link from 'next/link';

interface EventNavProps {
  eventId: string;
  eventName: string;
  displayName: string;
  roleLabel: string;
  operational: boolean;
  canApprove: boolean;
}

/**
 * Navigation is role-aware for presentation only. Every page re-checks the viewer's
 * capability on the server, so a hidden link is never the security control.
 */
export function EventNav({ eventId, eventName, displayName, roleLabel, operational, canApprove }: EventNavProps) {
  const base = `/events/${eventId}`;
  return (
    <nav className="nav" aria-label="Event navigation">
      <div className="nav__brand">
        HELLO <span>·</span>
        <div className="small muted" style={{ fontWeight: 400 }}>
          {eventName}
        </div>
      </div>
      <Link className="nav__link" href={`${base}/conversation`}>
        Conversation
      </Link>
      <Link className="nav__link" href={`${base}/incidents`}>
        {operational ? 'Incidents' : 'My requests'}
      </Link>
      <Link className="nav__link" href={`${base}/sessions`}>
        Sessions and rooms
      </Link>
      <Link className="nav__link" href={`${base}/people`}>
        People
      </Link>
      <Link className="nav__link" href={`${base}/notifications`}>
        Notifications
      </Link>
      {operational ? (
        <>
          <div className="nav__section">Operations</div>
          <Link className="nav__link" href={`${base}/operations`}>
            {canApprove ? 'Operations and approvals' : 'Operations'}
          </Link>
        </>
      ) : null}
      <div className="nav__section">Account</div>
      <Link className="nav__link" href={`${base}/settings`}>
        Settings
      </Link>
      <p className="small muted" style={{ padding: '0 12px', marginTop: 'auto' }}>
        {displayName}
        <br />
        {roleLabel}
      </p>
    </nav>
  );
}
