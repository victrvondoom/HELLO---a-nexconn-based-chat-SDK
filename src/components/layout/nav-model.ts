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

/**
 * The event navigation, grouped the way people think about an event: where you live (home, moments,
 * messages), the event itself, the people in it, and, for staff, the team's tools. Rarely used tools
 * sit under "More" so the everyday list stays short.
 *
 * This decides presentation only. Every page re-checks the viewer's capability on the server, so a
 * hidden link is never the security control.
 */
export function buildNav(input: NavInput): { groups: NavGroup[]; more: NavLinkItem[]; settings: NavLinkItem; notifications: NavLinkItem } {
  const base = `/events/${input.eventId}`;
  const groups: NavGroup[] = [
    {
      id: 'home',
      label: null,
      items: [
        { href: base, label: 'Home', icon: 'home', exact: true, keywords: 'today dashboard start' },
        { href: `${base}/feed`, label: 'Moments', icon: 'camera', keywords: 'feed stories posts reels memoreels explore photos videos' },
        { href: `${base}/conversation`, label: 'Ask HELLO', icon: 'conversation', keywords: 'conversation chat report problem help' },
        { href: `${base}/messages`, label: 'Messages', icon: 'lock', keywords: 'private direct encrypted dm' },
      ],
    },
    {
      id: 'event',
      label: 'The event',
      items: [
        { href: `${base}/sessions`, label: 'Schedule', icon: 'sessions', keywords: 'sessions rooms agenda talks' },
        { href: `${base}/map`, label: 'Venue map', icon: 'map', keywords: 'directions route floor plan' },
        { href: `${base}/live`, label: 'Live', icon: 'pin', keywords: 'live reports places happening now safety holds' },
        { href: `${base}/places`, label: 'My places', icon: 'heart', keywords: 'places saved favourites collections notes map wishlist' },
        { href: `${base}/atlas`, label: 'Field Atlas', icon: 'sparkle', keywords: 'missions xp badges levels quests' },
        { href: `${base}/announcements`, label: 'Announcements', icon: 'megaphone', keywords: 'news updates' },
        { href: `${base}/incidents`, label: input.operational ? 'Incidents' : 'My requests', icon: 'incidents', keywords: 'issues problems reports requests' },
      ],
    },
    {
      id: 'people',
      label: 'People',
      items: [
        { href: `${base}/people`, label: 'People', icon: 'people', keywords: 'profiles follow network attendees' },
        { href: `${base}/communities`, label: 'Communities', icon: 'groups', keywords: 'groups clubs' },
        { href: `${base}/kingdom/world`, label: 'Kingdom 3D', icon: 'sparkle', keywords: 'voxel 3d houses town world render' },
        { href: `${base}/kingdom/map`, label: 'Kingdom map', icon: 'map', keywords: 'atlas continents languages channels doors islands' },
        { href: `${base}/kingdom`, label: 'Kingdom', icon: 'home', keywords: 'world realm citizens home monarch forge voxel map caravan chatdom' },
        { href: `${base}/calls`, label: 'Calls', icon: 'video', keywords: 'video voice meet' },
        { href: `${base}/privacy-filter`, label: 'Privacy filter', icon: 'shield', keywords: 'blur faces qr codes phone numbers camera stream twitch privacy' },
        { href: `${base}/games`, label: 'Games', icon: 'game', keywords: 'play quiz four in a row' },
      ],
    },
  ];
  if (input.operational) {
    groups.push({
      id: 'team',
      label: 'Team',
      items: [
        { href: `${base}/operations`, label: input.canApprove ? 'Operations and approvals' : 'Operations', icon: 'operations', keywords: 'ops board sla approvals' },
        { href: `${base}/team`, label: 'Team', icon: 'team', keywords: 'staff availability' },
        ...(input.canManageAtlas ? [{ href: `${base}/atlas/manage`, label: 'Atlas management', icon: 'sparkle' as const, keywords: 'missions review stations levels' }] : []),
        { href: `${base}/agents`, label: 'Agent mesh', icon: 'agents', keywords: 'ai agents trace' },
        ...(input.canAudit ? [{ href: `${base}/audit`, label: 'Audit trail', icon: 'shield' as const, keywords: 'log history governance' }] : []),
      ],
    });
  } else if (input.canAudit) {
    groups.push({ id: 'team', label: 'Governance', items: [{ href: `${base}/audit`, label: 'Audit trail', icon: 'shield', keywords: 'log history governance' }] });
  }
  const more: NavLinkItem[] = [
    { href: `${base}/flow`, label: 'Workflow canvas', icon: 'flow', keywords: 'automation nodes run workflows' },
    { href: `${base}/live-map`, label: 'Live map', icon: 'pin', keywords: 'world location countries share' },
  ];
  const settings: NavLinkItem = { href: `${base}/settings`, label: 'Profile and settings', icon: 'settings', keywords: 'account privacy export erase tokens' };
  const notifications: NavLinkItem = { href: `${base}/notifications`, label: 'Notifications', icon: 'bell', count: input.unread, keywords: 'alerts updates unread' };
  return { groups, more, settings, notifications };
}

/** Every page the viewer's navigation offers, for the command palette and the mobile menu. */
export function allNavItems(nav: ReturnType<typeof buildNav>): NavLinkItem[] {
  return [...nav.groups.flatMap((g) => g.items), nav.notifications, ...nav.more, nav.settings];
}
