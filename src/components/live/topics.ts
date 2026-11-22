/**
 * Which live topics each view depends on. A view refreshes when a change to one of them arrives.
 * Topics are the store-level names published by src/lib/live/store.ts.
 *
 * Views are recognised from the URL they already use, so the polling hooks did not need to change:
 * `/api/events/<id>/<segment>…` for data hooks, `/events/<id>/<segment>…` for server-rendered pages.
 */
const API_TOPICS: Record<string, readonly string[]> = {
  communities: ['communities', 'posts'],
  kingdom: ['kingdom*'],
  calls: ['calls', 'privacyAlerts'],
  'privacy-filter': ['privacyFilters', 'privacyAlerts', 'notifications'],
  games: ['games'],
  flow: ['*'],
  atlas: ['field*', 'incidents', 'sessions', 'conditions'],
  location: ['locations', 'social', 'people'],
  feed: ['posts', 'comments', 'social', 'people'],
  dm: ['dm'],
  pay: ['payments'],
  payments: ['payments'],
  presence: ['presence', 'social'],
  messages: ['messages'],
  notifications: ['notifications'],
  chat: ['chatLinks'],
  maps: ['customMaps'],
};

const PAGE_TOPICS: Record<string, readonly string[]> = {
  '': ['*'],
  incidents: ['incidents', 'approvals', 'notifications'],
  team: ['memberships', 'incidents'],
  audit: ['audit'],
  notifications: ['notifications'],
  operations: ['incidents', 'approvals', 'signals', 'sessions', 'memberships'],
  conversation: ['messages', 'incidents', 'approvals', 'notifications'],
  announcements: ['announcements', 'approvals'],
  sessions: ['sessions'],
  live: ['liveReports', 'safetyHolds', 'incidents'],
  places: ['places', 'placeCollections'],
  kingdom: ['kingdom*'],
};

export interface LiveTarget {
  eventId: string | null;
  topics: readonly string[];
}

/** Topics for a data URL such as `/api/events/evt-1/games/game-2`. */
export function topicsForApi(url: string): LiveTarget {
  const match = /^\/api\/events\/([^/?#]+)\/?([^/?#]*)/.exec(url);
  if (!match) return { eventId: null, topics: [] };
  return { eventId: decodeURIComponent(match[1] ?? ''), topics: API_TOPICS[match[2] ?? ''] ?? [] };
}

/** Topics for a page path such as `/events/evt-1/incidents/inc-2`. */
export function topicsForPage(path: string): LiveTarget {
  const match = /^\/events\/([^/?#]+)\/?([^/?#]*)/.exec(path);
  if (!match) return { eventId: null, topics: [] };
  return { eventId: decodeURIComponent(match[1] ?? ''), topics: PAGE_TOPICS[match[2] ?? ''] ?? [] };
}
