import Link from 'next/link';
import { NavLinks, NavMore } from './NavLinks';
import { CreateMenu } from './CreateMenu';
import { MobileTabBar } from './MobileTabBar';
import { buildNav, type NavInput } from './nav-model';
import { HaloMark, Wordmark } from '@/components/brand/Wordmark';
import { Ghat } from '@/components/brand/Scenery';
import { Avatar } from '@/components/social/Avatar';

interface EventNavProps extends NavInput {
  eventName: string;
  displayName: string;
  roleLabel: string;
  isDemo: boolean;
  canPost: boolean;
}

/**
 * The sidebar on wide screens and the tab bar on phones. Navigation is role-aware for presentation only:
 * each page re-checks the viewer's capability on the server, so a hidden link is never the security control.
 */
export function EventNav(props: EventNavProps) {
  const nav = buildNav(props);
  const base = `/events/${props.eventId}`;

  return (
    <>
      <aside className="sidebar" aria-label="Event navigation">
        <Link href={base} className="brand" aria-label="HELLO home">
          <HaloMark size={36} />
          <span className="brand__text">
            <Wordmark height={24} id="wm-nav" title="HELLO" />
            <span className="brand__sub">Your event, at home</span>
          </span>
        </Link>

        <div className="event-card">
          <Ghat id="ghat-nav" className="event-card__scene" />
          <span className="event-card__text">
            <strong>{props.eventName}</strong>
            <span>
              <span className="event-card__dot" aria-hidden="true" />
              {props.isDemo ? 'Demo event · seeded data' : 'Happening now'}
            </span>
          </span>
        </div>

        <CreateMenu eventId={props.eventId} canPost={props.canPost} />

        <nav aria-label="Primary" className="nav">
          {nav.groups.map((group) => (
            <div key={group.id} className="nav-section">
              {group.label ? <div className="nav-group">{group.label}</div> : null}
              <NavLinks items={group.items} />
            </div>
          ))}
          <div className="nav-section">
            <NavMore items={nav.more} />
          </div>
        </nav>

        <Link href={nav.settings.href} className="nav-foot">
          <Avatar name={props.displayName} size={36} />
          <span className="nav-foot__text">
            <strong>{props.displayName}</strong>
            <span className="faint xs">{props.roleLabel} · Profile and settings</span>
          </span>
        </Link>
      </aside>

      <MobileTabBar eventId={props.eventId} groups={nav.groups} more={nav.more} settings={nav.settings} canPost={props.canPost} />
    </>
  );
}
