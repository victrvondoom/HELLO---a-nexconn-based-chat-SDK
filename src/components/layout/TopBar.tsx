import Link from 'next/link';
import { CommandPalette } from './CommandPalette';
import { allNavItems, buildNav, type NavInput } from './nav-model';
import { HaloMark } from '@/components/brand/Wordmark';
import { Icon } from '@/components/ui/Icon';
import { Avatar } from '@/components/social/Avatar';

/**
 * The bar above every event page: where you are, search, notifications and you. It deliberately shows
 * counts only, never notification or incident text, so nothing private appears in the chrome.
 */
export function TopBar(props: NavInput & { eventName: string; isDemo: boolean; displayName: string; roleLabel: string }) {
  const nav = buildNav(props);
  const unread = props.unread;
  return (
    <header className="topbar">
      <Link href={`/events/${props.eventId}`} className="topbar__mark" aria-label="HELLO home">
        <HaloMark size={30} />
      </Link>
      <div className="topbar__event">
        <span className="eyebrow">{props.isDemo ? 'Demo event' : 'Event'}</span>
        <strong>{props.eventName}</strong>
      </div>
      <div className="topbar__tools">
        <CommandPalette items={allNavItems(nav)} />
        <Link href={nav.notifications.href} className="topbar__icon" aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}>
          <Icon name="bell" size={20} />
          {unread > 0 ? (
            <span className="nav-count" aria-hidden="true">
              {unread > 99 ? '99+' : unread}
            </span>
          ) : null}
        </Link>
        <span className="badge badge--accent topbar__role hide-sm">{props.roleLabel}</span>
        <Link href={nav.settings.href} className="topbar__me" aria-label="Profile and settings">
          <Avatar name={props.displayName} size={34} />
        </Link>
      </div>
    </header>
  );
}
