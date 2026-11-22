/**
 * The product map: every feature HELLO has or plans, in plain words, with an honest status.
 * One source for the public Guide page (/guide) and for docs/PROJECT_PATH.md, so a newcomer, a
 * developer and the owner all read the same list. Statuses mean:
 *
 * - LIVE: built and covered by tests in this repository.
 * - PARTIAL: built, with a stated limit.
 * - PLANNED: not built. Listed so the gap is visible, never hidden.
 */
export type FeatureStatus = 'LIVE' | 'PARTIAL' | 'PLANNED';

export interface GuideFeature {
  name: string;
  /** What a person does with it, in one plain sentence. */
  what: string;
  /** The page, relative to an event (`/events/<id>` + path). Empty for features with no page of their own. */
  path: string;
  status: FeatureStatus;
  /** The familiar product it is closest to, or null. */
  like: string | null;
  /** The limit, for PARTIAL and PLANNED. */
  note?: string;
}

export interface GuideArea {
  id: string;
  title: string;
  blurb: string;
  features: GuideFeature[];
}

export const GUIDE: GuideArea[] = [
  {
    id: 'share',
    title: 'Share',
    blurb: 'Post what is happening. Feed, stories and reels, ordered by rules anyone can read.',
    features: [
      { name: 'Posts', what: 'Share text, a photo or a video. Like, comment, save or repost.', path: '/feed', status: 'LIVE', like: 'X, Instagram, Facebook' },
      { name: 'Stories and highlights', what: 'Share a moment that disappears after 24 hours, or keep it in a highlight.', path: '/feed', status: 'LIVE', like: 'Instagram' },
      { name: 'Reels', what: 'Scroll short videos one after another.', path: '/feed/reels', status: 'LIVE', like: 'YouTube Shorts, Instagram Reels' },
      { name: 'Explore and trends', what: 'See what the event is talking about. A tag trends only when 3 different people use it.', path: '/feed/explore', status: 'LIVE', like: 'X' },
      { name: 'Saved', what: 'Keep posts for later. Your saves are private.', path: '/feed/saved', status: 'LIVE', like: 'Instagram' },
      { name: 'Open feed rules', what: 'See exactly why each post is where it is.', path: '/feed/charter', status: 'LIVE', like: null },
      { name: 'Long videos and channels', what: 'Upload and watch long videos on a channel page.', path: '', status: 'PLANNED', like: 'YouTube', note: 'Not built. Videos today are short posts and reels.' },
      { name: 'Live streaming', what: 'Go live and let people watch and chat.', path: '', status: 'PLANNED', like: 'YouTube Live, Twitch', note: 'Not built. Calls work between people, not as a broadcast.' },
      { name: 'Polls', what: 'Ask a question with 2 to 4 options. One vote each; results show after you vote or the poll closes.', path: '/feed', status: 'LIVE', like: 'X' },
      { name: 'Threads', what: 'Chain posts into a thread.', path: '', status: 'PLANNED', like: 'X', note: 'Not built.' },
    ],
  },
  {
    id: 'talk',
    title: 'Talk',
    blurb: 'Private messages, groups, calls and an assistant that knows the event.',
    features: [
      { name: 'Private messages', what: 'Send end-to-end encrypted messages to one person.', path: '/messages', status: 'PARTIAL', like: 'X DMs, Messenger', note: 'No forward secrecy; one key per device.' },
      { name: 'Communities', what: 'Join or run a group around a topic.', path: '/communities', status: 'LIVE', like: 'Facebook Groups' },
      { name: 'People and following', what: 'Find people, view profiles, follow back. You choose who can find you.', path: '/people', status: 'LIVE', like: 'X, Facebook' },
      { name: 'Video calls', what: 'Call one or more people from the browser.', path: '/calls', status: 'PARTIAL', like: 'Meet, Messenger', note: 'Tested between two browsers on one machine. Across networks needs a TURN server.' },
      { name: 'Ask HELLO', what: 'Ask a question or report a problem in plain words.', path: '/conversation', status: 'LIVE', like: null },
      { name: 'Search', what: 'Find pages, people and posts you are allowed to see.', path: '', status: 'LIVE', like: null, note: 'Press the search button in the top bar.' },
    ],
  },
  {
    id: 'play',
    title: 'Play',
    blurb: 'Things to do that reward you for taking part.',
    features: [
      { name: 'Games', what: 'Play quick games against another person.', path: '/games', status: 'LIVE', like: null },
      { name: 'Field Atlas', what: 'Complete missions around the venue to earn XP, levels and badges.', path: '/atlas', status: 'LIVE', like: null },
      { name: 'Opt-in leaderboard', what: 'Show your rank only if you choose to.', path: '/atlas', status: 'LIVE', like: null },
    ],
  },
  {
    id: 'place',
    title: 'The place',
    blurb: 'Where things are and what is happening right now.',
    features: [
      { name: 'Schedule', what: 'See sessions, times and rooms.', path: '/sessions', status: 'LIVE', like: null },
      { name: 'Venue map', what: 'See the floor plan and find a route.', path: '/map', status: 'LIVE', like: null },
      { name: 'Live', what: 'Tell people what a place is like right now: crowded, broken, closed.', path: '/live', status: 'LIVE', like: 'Waze' },
      { name: 'My places', what: 'Keep private places with notes, photos, collections and check-ins.', path: '/places', status: 'LIVE', like: 'Google Maps lists' },
      { name: 'Announcements', what: 'Read official updates.', path: '/announcements', status: 'LIVE', like: null },
      { name: 'What is new', what: 'See posts and updates since you last left, with no streaks and no pressure.', path: '/catch-up', status: 'LIVE', like: null },
      { name: 'Notifications', what: 'See what changed for you.', path: '/notifications', status: 'PARTIAL', like: null, note: 'In the app only. No push to your phone yet.' },
    ],
  },
  {
    id: 'run',
    title: 'Run the event (organisers and staff)',
    blurb: 'Tools for the team. Attendees do not see them.',
    features: [
      { name: 'Incidents and requests', what: 'Report, claim, work and close problems. The reporter confirms the fix.', path: '/incidents', status: 'LIVE', like: null },
      { name: 'Operations and approvals', what: 'A board of open work. Changes to published things wait for an organiser.', path: '/operations', status: 'LIVE', like: null },
      { name: 'Safety holds', what: 'Pause the live view for a zone while a safety report is checked. A different organiser must release it.', path: '/live', status: 'LIVE', like: null },
      { name: 'Team', what: 'See who is available and where.', path: '/team', status: 'LIVE', like: null },
      { name: 'Atlas management', what: 'Create missions, review evidence, set levels.', path: '/atlas/manage', status: 'LIVE', like: null },
      { name: 'Agent mesh', what: 'See what the automatic helpers did and why.', path: '/agents', status: 'LIVE', like: null },
      { name: 'Audit trail', what: 'Read who did what, and when.', path: '/audit', status: 'LIVE', like: null },
      { name: 'Workflow canvas', what: 'Build simple automations from blocks.', path: '/flow', status: 'LIVE', like: 'Zapier' },
    ],
  },
  {
    id: 'yours',
    title: 'You and your data',
    blurb: 'Control what is shared. Take it with you or erase it.',
    features: [
      { name: 'Profile and settings', what: 'Change your name, privacy and tokens.', path: '/settings', status: 'LIVE', like: null },
      { name: 'Export and erase', what: 'Download everything about you, or delete it.', path: '/settings', status: 'LIVE', like: null },
      { name: 'Phone-sized screens', what: 'Every page works on a phone, with a bottom tab bar.', path: '', status: 'LIVE', like: null },
      { name: 'Native iOS and Android apps', what: 'An installable app with background location and share sheet.', path: '', status: 'PLANNED', like: null, note: 'Not built. Needs a Mac and a device for iOS.' },
      { name: 'Real chat network (Nexconn)', what: 'Messages carried by the Nexconn network.', path: '', status: 'PLANNED', like: null, note: 'Needs credentials. A stand-in bridge is tested.' },
    ],
  },
];

export const STATUS_LABEL: Record<FeatureStatus, string> = {
  LIVE: 'Works now',
  PARTIAL: 'Works, with a limit',
  PLANNED: 'Not built yet',
};

/** The four-step route a new person should take, in order. */
export const FIRST_STEPS: Array<{ title: string; body: string }> = [
  { title: 'Open the demo', body: 'Pick a demo person. Ada is an attendee; Nadia is an organiser.' },
  { title: 'Look at Moments', body: 'Post something, open a story, scroll the reels.' },
  { title: 'Try one real task', body: 'Report a problem with Ask HELLO, then switch to an organiser and watch it arrive.' },
  { title: 'Save a place', body: 'Open My places, add a place and check in at the Atrium.' },
];

export function countByStatus(): Record<FeatureStatus, number> {
  const counts: Record<FeatureStatus, number> = { LIVE: 0, PARTIAL: 0, PLANNED: 0 };
  for (const area of GUIDE) for (const feature of area.features) counts[feature.status] += 1;
  return counts;
}
