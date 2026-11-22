import Link from 'next/link';
import { NavLinks, NavMore } from './NavLinks';
import { MobileTabBar } from './MobileTabBar';
import { buildNav, type NavInput } from './nav-model';
import { HaloMark, Wordmark } from '@/components/brand/Wordmark';
import { Avatar } from '@/components/social/Avatar';
import { Icon } from '@/components/ui/Icon';

interface EventNavProps extends NavInput {
  eventName: string;
  displayName: string;
  roleLabel: string;
  isDemo: boolean;
  canPost: boolean;
}

/**
 * The sidebar on wide screens and the tab bar on phones. Deliberately small: the five destinations, one
 * invitation into the 3D Kingdom, and everything else folded away. Navigation is role-aware for
 * presentation only: each page re-checks the viewer's capability on the server.
 */
export function EventNav(props: EventNavProps) {
  const nav = buildNav(props);
  const base = `/events/${props.eventId}`;

  return (
    <>
      <aside className="sidebar sidebar--calm" aria-label="Event navigation">
        <Link href={base} className="brand" aria-label="HELLO home">
          <HaloMark size={32} />
          <span className="brand__text">
            <Wordmark height={22} id="wm-nav" title="HELLO" />
            <span className="brand__sub">{props.eventName}</span>
          </span>
        </Link>

        <nav aria-label="Primary" className="nav">
          {nav.groups.map((group) => (
            <div key={group.id} className="nav-section">
              {group.label ? <div className="nav-group">{group.label}</div> : null}
              <NavLinks items={group.items} />
            </div>
          ))}
          <Link href={nav.kingdom.href} className="kingdom-door">
            <span className="kingdom-door__icon" aria-hidden="true">
              <Icon name="sparkle" size={18} />
            </span>
            <span className="grow">
              <strong>Enter the Kingdom</strong>
              <span className="xs">Your 3D world</span>
            </span>
          </Link>
          <div className="nav-section">
            <NavMore items={nav.more} label="Everything else" />
          </div>
        </nav>

        <Link href={nav.settings.href} className="nav-foot">
          <Avatar name={props.displayName} size={32} />
          <span className="nav-foot__text">
            <strong>{props.displayName}</strong>
            <span className="faint xs">{props.roleLabel}{props.isDemo ? ' · demo' : ''}</span>
          </span>
        </Link>
      </aside>

      <MobileTabBar eventId={props.eventId} groups={nav.groups} kingdom={nav.kingdom} more={nav.more} settings={nav.settings} canPost={props.canPost} />
    </>
  );
}
