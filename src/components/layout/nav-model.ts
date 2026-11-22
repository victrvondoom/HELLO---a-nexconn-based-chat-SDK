import type { NavLinkItem } from './NavLinks';

export interface NavInput {
  eventId: string;
  operational: boolean;
  canApprove: boolean;
  canAudit: boolean;
  canManageAtlas: boolean;
  unread: number;
}

export interface NavGroup {
  id: string;
  /** Shown above the group. The first group has none. */
  label: string | null;
  items: NavLinkItem[];
}

export interface Nav {
  /** The primary destinations: Today, Explore, Live, People, and Operations for staff. Never more than five. */
  groups: NavGroup[];
  /** The 3D kingdom: not a destination of its own but the one place the sidebar invites people to step into. */
  kingdom: NavLinkItem;
  /** Every other page, folded away. Also in the command palette and the phone menu. */
  more: NavLinkItem[];
  settings: NavLinkItem;
  notifications: NavLinkItem;
}

/**
 * The event navigation is five destinations at most (docs/HELLO_PRODUCT_SPEC.md §2):
 *
 *   Today | Explore | Live | People   (+ Operations for organisers, operations staff and crew)
 *
 * Today decides what matters now; Explore finds anything; Live is the session room; People is networking;
 * Operations is the staff workspace. Every older page still exists and is one tap away under "Everything
 * else", in the command palette and in the phone menu, so nothing was removed.
 *
 * This decides presentation only. Every page re-checks the viewer's capability on the server, so a
 * hidden link is never the security control.
 */
export function buildNav(input: NavInput): Nav {
  const base = `/events/${input.eventId}`;
  const primary: NavLinkItem[] = [
    { href: base, label: 'Today', icon: 'home', exact: true, keywords: 'home dashboard start next session plan b break' },
    { href: `${base}/explore`, label: 'Explore', icon: 'compass', keywords: 'search programme schedule sessions speakers topics glossary venue map' },
    { href: `${base}/now`, label: 'Live', icon: 'mic', keywords: 'session room captions questions slides cant hear cant see qr' },
    { href: `${base}/people`, label: 'People', icon: 'people', keywords: 'profiles follow network attendees connections meet' },
  ];
  if (input.operational) {
    primary.push({ href: `${base}/operations`, label: 'Operations', icon: 'operations', keywords: 'ops board sla approvals incidents av rooms resilience steadfast verification' });
  }
  const groups: NavGroup[] = [{ id: 'main', label: null, items: primary }];

  const kingdom: NavLinkItem = { href: `${base}/kingdom/world`, label: 'Enter the Kingdom', icon: 'sparkle', keywords: 'kingdom 3d voxel houses town world render realm' };

  // Everything else, in the order people reach for it.
  const more: NavLinkItem[] = [
    { href: `${base}/feed`, label: 'Moments', icon: 'camera', keywords: 'feed stories posts reels memoreels explore photos videos' },
    { href: `${base}/conversation`, label: 'Ask HELLO', icon: 'conversation', keywords: 'conversation chat report problem help' },
    { href: `${base}/messages`, label: 'Messages', icon: 'lock', keywords: 'private direct encrypted dm' },
    { href: `${base}/sessions`, label: 'Schedule', icon: 'sessions', keywords: 'sessions rooms agenda talks' },
    { href: `${base}/map`, label: 'Venue map', icon: 'map', keywords: 'directions route floor plan 3d heat map first floor second floor' },
    { href: `${base}/announcements`, label: 'Announcements', icon: 'megaphone', keywords: 'news updates' },
    { href: `${base}/incidents`, label: input.operational ? 'Incidents' : 'My requests', icon: 'incidents', keywords: 'issues problems reports requests' },
    { href: `${base}/communities`, label: 'Communities', icon: 'groups', keywords: 'groups clubs' },
    { href: `${base}/kingdom`, label: 'Kingdom', icon: 'home', keywords: 'world realm citizens home monarch forge chatdom' },
    { href: `${base}/kingdom/map`, label: 'Kingdom map', icon: 'map', keywords: 'atlas continents languages channels doors islands' },
    { href: `${base}/calls`, label: 'Calls', icon: 'video', keywords: 'video voice meet' },
    { href: `${base}/games`, label: 'Games', icon: 'game', keywords: 'play quiz four in a row create game' },
    { href: `${base}/live`, label: 'Live reports', icon: 'pin', keywords: 'live reports places happening now safety holds crowding' },
    { href: `${base}/places`, label: 'My places', icon: 'heart', keywords: 'places saved favourites collections notes map wishlist' },
    { href: `${base}/atlas`, label: 'Field Atlas', icon: 'sparkle', keywords: 'missions xp badges levels quests' },
    { href: `${base}/flow`, label: 'Workflow canvas', icon: 'flow', keywords: 'automation nodes run workflows' },
    { href: `${base}/live-map`, label: 'Live map', icon: 'pin', keywords: 'world location countries share' },
    { href: `${base}/privacy-filter`, label: 'Privacy filter', icon: 'shield', keywords: 'blur faces qr codes phone numbers camera stream twitch privacy' },
  ];
  if (input.operational) {
    more.push(
      { href: `${base}/team`, label: 'Team', icon: 'team', keywords: 'staff availability' },
      { href: `${base}/agents`, label: 'Agent mesh', icon: 'agents', keywords: 'ai agents trace' },
    );
    if (input.canManageAtlas) more.push({ href: `${base}/atlas/manage`, label: 'Atlas management', icon: 'sparkle', keywords: 'missions review stations levels' });
  }
  if (input.canAudit) more.push({ href: `${base}/audit`, label: 'Audit trail', icon: 'shield', keywords: 'log history governance' });

  const settings: NavLinkItem = { href: `${base}/settings`, label: 'Profile and settings', icon: 'settings', keywords: 'account privacy export erase tokens' };
  const notifications: NavLinkItem = { href: `${base}/notifications`, label: 'Notifications', icon: 'bell', count: input.unread, keywords: 'alerts updates unread' };
  return { groups, kingdom, more, settings, notifications };
}

/** Every page the viewer's navigation offers, for the command palette and the mobile menu. */
export function allNavItems(nav: Nav): NavLinkItem[] {
  return [...nav.groups.flatMap((g) => g.items), nav.kingdom, nav.notifications, ...nav.more, nav.settings];
}
