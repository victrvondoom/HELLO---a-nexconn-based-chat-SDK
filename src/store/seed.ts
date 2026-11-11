import type {
  ProfileVisibility,
  ReferenceDoc,
  Announcement,
  ApprovalRequest,
  Notification,
  EventRecord,
  Incident,
  IncidentReport,
  IncidentTimelineEntry,
  Membership,
  Room,
  Session,
  User,
} from '../domain/types';
import type { MemoryHelloStore } from './memory';
import type { Vault } from '../lib/vault';
import { buildDemoVenue } from './venue-seed';

/**
 * DEMO SEED DATA — every record here is fictional and exists only to demonstrate
 * HELLO. The event, all people, rooms, sessions, occupancy figures and incidents are
 * labelled `isDemo` / `DEMO_SEED`. Nothing here is real event information.
 */

export const DEMO_EVENT_ID = 'evt-demo-hello-summit';

/** Fixed reference time for the demo timeline (2026-11-10 09:00 UTC). */
export const DEMO_T0 = Date.UTC(2026, 10, 10, 9, 0, 0);
const HOUR = 60 * 60 * 1000;
const MIN = 60 * 1000;

export const DEMO_USERS = {
  attendeeAda: 'u-att-ada',
  attendeeBen: 'u-att-ben',
  attendeeChloe: 'u-att-chloe',
  attendeeDev: 'u-att-dev',
  attendeeEli: 'u-att-eli',
  attendeeFatima: 'u-att-fatima',
  attendeeGus: 'u-att-gus',
  attendeeHana: 'u-att-hana',
  speakerInes: 'u-spk-ines',
  volunteerJamal: 'u-vol-jamal',
  opsKiri: 'u-ops-kiri',
  opsLena: 'u-ops-lena',
  opsMarco: 'u-ops-marco',
  organiserNadia: 'u-org-nadia',
  adminRami: 'u-adm-rami',
  organiserOwen: 'u-org-owen',
} as const;

export function buildDemoData(): {
  events: EventRecord[];
  users: User[];
  memberships: Membership[];
  rooms: Room[];
  sessions: Session[];
  incidents: Incident[];
  reports: IncidentReport[];
  timeline: IncidentTimelineEntry[];
  approvals: ApprovalRequest[];
  announcements: Announcement[];
  notifications: Notification[];
} {
  const now = DEMO_T0 + 3 * HOUR; // 12:00 UTC: the event is in progress
  const E = DEMO_EVENT_ID;

  const events: EventRecord[] = [
    { id: E, name: 'HELLO Global Technology Summit', timezone: 'UTC', isDemo: true, venueCity: 'Lisbon' },
  ];

  const users: User[] = [
    { id: DEMO_USERS.attendeeAda, displayName: 'Ada (demo attendee)', interests: ['satellite power', 'robotics'], discoverable: true, accessibilityRequired: false },
    { id: DEMO_USERS.attendeeBen, displayName: 'Ben (demo attendee)', interests: ['cybersecurity'], discoverable: true, accessibilityRequired: false },
    { id: DEMO_USERS.attendeeChloe, displayName: 'Chloe (demo attendee)', interests: ['edge computing'], discoverable: true, accessibilityRequired: true },
    { id: DEMO_USERS.attendeeDev, displayName: 'Dev (demo attendee)', interests: ['satellite communication'], discoverable: true, accessibilityRequired: false },
    { id: DEMO_USERS.attendeeEli, displayName: 'Eli (demo attendee)', interests: ['cybersecurity', 'zero trust'], discoverable: false, accessibilityRequired: false },
    { id: DEMO_USERS.attendeeFatima, displayName: 'Fatima (demo attendee)', interests: [], discoverable: false, accessibilityRequired: false },
    { id: DEMO_USERS.attendeeGus, displayName: 'Gus (demo attendee)', interests: [], discoverable: false, accessibilityRequired: false },
    { id: DEMO_USERS.attendeeHana, displayName: 'Hana (demo attendee)', interests: [], discoverable: false, accessibilityRequired: false },
    { id: DEMO_USERS.speakerInes, displayName: 'Dr Ines (demo speaker)', interests: ['satellite power systems'], discoverable: true, accessibilityRequired: false },
    { id: DEMO_USERS.volunteerJamal, displayName: 'Jamal (demo volunteer)', interests: [], discoverable: false, accessibilityRequired: false },
    { id: DEMO_USERS.opsKiri, displayName: 'Kiri (demo AV technician)', interests: [], discoverable: false, accessibilityRequired: false },
    { id: DEMO_USERS.opsLena, displayName: 'Lena (demo operations)', interests: [], discoverable: false, accessibilityRequired: false },
    { id: DEMO_USERS.opsMarco, displayName: 'Marco (demo access coordinator)', interests: [], discoverable: false, accessibilityRequired: false },
    { id: DEMO_USERS.organiserNadia, displayName: 'Nadia (demo organiser)', interests: [], discoverable: false, accessibilityRequired: false },
    { id: DEMO_USERS.adminRami, displayName: 'Rami (demo platform admin)', interests: [], discoverable: false, accessibilityRequired: false },
    { id: DEMO_USERS.organiserOwen, displayName: 'Owen (demo organiser)', interests: [], discoverable: false, accessibilityRequired: false },
  ];

  const membership = (
    id: string,
    userId: string,
    role: Membership['role'],
    skills: string[],
    availability: Membership['availability'] = 'AVAILABLE',
    zone: string | null = null,
  ): Membership => ({ id, eventId: E, userId, role, skills, availability, zone });

  const memberships: Membership[] = [
    membership('m-ada', DEMO_USERS.attendeeAda, 'ATTENDEE', []),
    membership('m-ben', DEMO_USERS.attendeeBen, 'ATTENDEE', []),
    membership('m-chloe', DEMO_USERS.attendeeChloe, 'ATTENDEE', []),
    membership('m-dev', DEMO_USERS.attendeeDev, 'ATTENDEE', []),
    membership('m-eli', DEMO_USERS.attendeeEli, 'ATTENDEE', []),
    membership('m-fatima', DEMO_USERS.attendeeFatima, 'ATTENDEE', []),
    membership('m-gus', DEMO_USERS.attendeeGus, 'ATTENDEE', []),
    membership('m-hana', DEMO_USERS.attendeeHana, 'ATTENDEE', []),
    membership('m-ines', DEMO_USERS.speakerInes, 'SPEAKER', []),
    membership('m-jamal', DEMO_USERS.volunteerJamal, 'VOLUNTEER', ['GENERAL', 'STEWARDING'], 'AVAILABLE', 'Main'),
    membership('m-kiri', DEMO_USERS.opsKiri, 'OPERATIONS_STAFF', ['AV'], 'AVAILABLE', 'Workshop'),
    membership('m-lena', DEMO_USERS.opsLena, 'OPERATIONS_STAFF', ['AV', 'FACILITIES'], 'AVAILABLE', 'Main'),
    membership('m-marco', DEMO_USERS.opsMarco, 'OPERATIONS_STAFF', ['ACCESSIBILITY'], 'BUSY', 'Main'),
    membership('m-nadia', DEMO_USERS.organiserNadia, 'ORGANISER', [], 'AVAILABLE', 'Main'),
    membership('m-owen', DEMO_USERS.organiserOwen, 'ORGANISER', [], 'AVAILABLE', 'Workshop'),
  ];

  // Occupancy here is demo data, labelled DEMO_SEED. HELLO has no sensor integration in this build.
  const rooms: Room[] = [
    { id: 'r-main', eventId: E, name: 'Main Hall', zone: 'Main', capacity: 300, accessible: true, equipment: ['microphone', 'projector', 'screen'], occupancy: 210, occupancySource: 'DEMO_SEED' },
    { id: 'r-2', eventId: E, name: 'Room 2', zone: 'Workshop', capacity: 60, accessible: false, equipment: ['projector'], occupancy: 18, occupancySource: 'DEMO_SEED' },
    { id: 'r-3', eventId: E, name: 'Room 3', zone: 'Workshop', capacity: 40, accessible: true, equipment: ['microphone', 'projector'], occupancy: 52, occupancySource: 'DEMO_SEED' },
    { id: 'r-4', eventId: E, name: 'Room 4', zone: 'Main', capacity: 80, accessible: true, equipment: ['microphone', 'screen'], occupancy: null, occupancySource: null },
  ];

  const sessions: Session[] = [
    { id: 's-keynote', eventId: E, title: 'Keynote: Coordinating Physical Events', topics: ['events', 'coordination'], roomId: 'r-main', startsAt: DEMO_T0, endsAt: DEMO_T0 + HOUR, capacity: 300, enrolled: 280, accessible: true, speakerUserId: null },
    { id: 's-sat-power', eventId: E, title: 'Satellite Power Systems', topics: ['satellite power', 'space engineering'], roomId: 'r-3', startsAt: DEMO_T0 + 4 * HOUR, endsAt: DEMO_T0 + 5 * HOUR, capacity: 40, enrolled: 40, accessible: true, speakerUserId: DEMO_USERS.speakerInes },
    { id: 's-robotics', eventId: E, title: 'Robotics in Practice', topics: ['robotics', 'automation'], roomId: 'r-main', startsAt: DEMO_T0 + 4 * HOUR, endsAt: DEMO_T0 + 5 * HOUR, capacity: 300, enrolled: 210, accessible: true, speakerUserId: null },
    { id: 's-zero-trust', eventId: E, title: 'Zero Trust for Event Networks', topics: ['cybersecurity', 'zero trust'], roomId: 'r-2', startsAt: DEMO_T0 + 5 * HOUR, endsAt: DEMO_T0 + 6 * HOUR, capacity: 60, enrolled: 20, accessible: false, speakerUserId: null },
    { id: 's-edge', eventId: E, title: 'Edge Computing at Scale', topics: ['edge computing'], roomId: 'r-4', startsAt: DEMO_T0 + 5 * HOUR, endsAt: DEMO_T0 + 6 * HOUR, capacity: 80, enrolled: 30, accessible: true, speakerUserId: null },
    { id: 's-sat-comms', eventId: E, title: 'Satellite Communication Networks', topics: ['satellite communication', 'satellite power systems'], roomId: 'r-main', startsAt: DEMO_T0 + 6 * HOUR, endsAt: DEMO_T0 + 7 * HOUR, capacity: 300, enrolled: 90, accessible: true, speakerUserId: null },
  ];

  // Seeded history. Incidents raised by named demo attendees, so related-report matching has real evidence to find.
  const incidents: Incident[] = [
    incidentRecord('inc-seed-av-r3', E, 'AV', 'TRIAGED', 'MEDIUM', 'Microphone crackling in Room 3', 'r-3', 's-sat-power', ['microphone'], DEMO_USERS.attendeeFatima, now - 12 * MIN, now - 12 * MIN),
    incidentRecord('inc-seed-cap-r3', E, 'CAPACITY', 'TRIAGED', 'HIGH', 'Room 3 is overcrowded', 'r-3', 's-sat-power', [], DEMO_USERS.attendeeGus, now - 9 * MIN, now - 9 * MIN),
    {
      ...incidentRecord('inc-seed-fac-r2', E, 'FACILITIES', 'CLOSED', 'LOW', 'Projector cable loose in Room 2', 'r-2', null, [], DEMO_USERS.attendeeChloe, now - 2 * HOUR, now - 90 * MIN),
      resolvedAt: now - 100 * MIN,
      confirmedAt: now - 95 * MIN,
      resolutionNote: 'Cable re-secured and tested.',
    },
  ];

  const reports: IncidentReport[] = [
    report('rpt-seed-1', 'inc-seed-av-r3', E, DEMO_USERS.attendeeFatima, 'The microphone in Room 3 is crackling badly', now - 12 * MIN, 1, ['created']),
    report('rpt-seed-2', 'inc-seed-cap-r3', E, DEMO_USERS.attendeeGus, 'Too many people in Room 3, I cannot get in', now - 9 * MIN, 1, ['created']),
    report('rpt-seed-3', 'inc-seed-fac-r2', E, DEMO_USERS.attendeeChloe, 'Projector cable is loose in Room 2', now - 2 * HOUR, 1, ['created']),
  ];

  const timeline: IncidentTimelineEntry[] = [
    timelineEntry('tl-seed-1', 'inc-seed-av-r3', E, 'CREATED', DEMO_USERS.attendeeFatima, null, 'TRIAGED', 'Reported by a demo attendee and triaged automatically.', now - 12 * MIN),
    timelineEntry('tl-seed-2', 'inc-seed-cap-r3', E, 'CREATED', DEMO_USERS.attendeeGus, null, 'TRIAGED', 'Reported by a demo attendee and triaged automatically.', now - 9 * MIN),
    timelineEntry('tl-seed-3', 'inc-seed-fac-r2', E, 'CREATED', DEMO_USERS.attendeeChloe, null, 'TRIAGED', 'Reported by a demo attendee.', now - 2 * HOUR),
    timelineEntry('tl-seed-4', 'inc-seed-fac-r2', E, 'STATUS_CHANGED', DEMO_USERS.opsLena, 'TRIAGED', 'CLOSED', 'Resolved and confirmed by the reporter.', now - 95 * MIN),
  ];

  const approvals: ApprovalRequest[] = [
    {
      id: 'apr-seed-move-s-sat-power',
      eventId: E,
      actionType: 'MOVE_SESSION_ROOM',
      payload: { sessionId: 's-sat-power', toRoomId: 'r-4' },
      justification: 'Session is over capacity in Room 3 and the speaker has a larger room free at this time. Demo request.',
      requestedByUserId: DEMO_USERS.opsLena,
      status: 'PENDING',
      expiresAt: now + 2 * HOUR,
      decidedByUserId: null,
      decidedAt: null,
      decisionReason: null,
      executionStatus: 'NOT_STARTED',
      executionResult: null,
      executedAt: null,
      linkedIncidentId: 'inc-seed-cap-r3',
      version: 0,
    },
  ];

  const announcements: Announcement[] = [
    {
      id: 'ann-seed-doors',
      eventId: E,
      title: 'Doors and registration',
      body: 'Registration desks are open in the Main Hall foyer. Badges are required for every session room.',
      publishedByUserId: DEMO_USERS.organiserNadia,
      publishedAt: now - 3 * HOUR,
    },
  ];

  const notifications: Notification[] = [
    {
      id: 'ntf-seed-ada-1',
      eventId: E,
      recipientUserId: DEMO_USERS.attendeeAda,
      kind: 'INCIDENT_UPDATE',
      body: 'Microphone crackling in Room 3: Triaged, waiting for an assignee.',
      href: `/events/${E}/incidents/inc-seed-av-r3`,
      dedupeKey: 'seed-ada-1',
      createdAt: now - 7 * MIN,
      readAt: null,
    },
    {
      id: 'ntf-seed-ada-2',
      eventId: E,
      recipientUserId: DEMO_USERS.attendeeAda,
      kind: 'INCIDENT_UPDATE',
      body: 'Welcome to HELLO. Report problems in the conversation and you will hear back here.',
      href: `/events/${E}/conversation`,
      dedupeKey: 'seed-ada-2',
      createdAt: now - 2 * HOUR,
      readAt: now - 2 * HOUR + 5 * MIN,
    },
  ];

  return { events, users, memberships, rooms, sessions, incidents, reports, timeline, approvals, announcements, notifications };
}

function incidentRecord(
  id: string,
  eventId: string,
  category: Incident['category'],
  status: Incident['status'],
  urgency: Incident['urgency'],
  title: string,
  roomId: string | null,
  sessionId: string | null,
  equipment: string[],
  createdByUserId: string,
  createdAt: number,
  updatedAt: number,
): Incident {
  return {
    id,
    eventId,
    category,
    status,
    urgency,
    title,
    roomId,
    sessionId,
    equipment,
    createdByUserId,
    assigneeUserId: null,
    version: 1,
    createdAt,
    updatedAt,
    acknowledgedAt: null,
    resolvedAt: null,
    confirmedAt: null,
    resolutionNote: null,
  };
}

function report(
  id: string,
  incidentId: string,
  eventId: string,
  reporterUserId: string,
  text: string,
  createdAt: number,
  matchConfidence: number,
  matchSignals: string[],
): IncidentReport {
  return { id, incidentId, eventId, reporterUserId, text, createdAt, matchConfidence, matchSignals };
}

function timelineEntry(
  id: string,
  incidentId: string,
  eventId: string,
  type: IncidentTimelineEntry['type'],
  actorUserId: string | null,
  fromStatus: IncidentTimelineEntry['fromStatus'],
  toStatus: IncidentTimelineEntry['toStatus'],
  detail: string,
  at: number,
): IncidentTimelineEntry {
  return { id, incidentId, eventId, type, actorUserId, fromStatus, toStatus, detail, at };
}

/**
 * Loads the demo event into an empty in-memory store. Must be called once per store;
 * the store rejects duplicate ids, so a second call fails loudly instead of doubling data.
 */
/**
 * The demo event guide. Fictional venue facts written for the demo, labelled DEMO_SEED, so every
 * answer an agent gives from them is traceable to a page an organiser would own in a real event.
 */
export function buildReferenceDocs(eventId: string, at: number): ReferenceDoc[] {
  const doc = (
    id: string,
    title: string,
    body: string,
    tags: string[],
    extra: Partial<Pick<ReferenceDoc, 'categories' | 'audience'>> = {},
  ): ReferenceDoc => ({
    id,
    eventId,
    title,
    body,
    tags,
    categories: extra.categories ?? [],
    audience: extra.audience ?? 'EVERYONE',
    source: 'DEMO_SEED',
    updatedAt: at,
  });
  return [
    doc(
      'ref-wifi',
      'Wi-Fi and charging',
      'The event network is HELLO-Summit and the password is printed on the back of your badge. Charging lockers are next to the registration desk on the ground floor and in the Workshop corridor outside Room 2.',
      ['wifi', 'wi-fi', 'internet', 'network', 'password', 'charging', 'charger', 'phone', 'battery'],
    ),
    doc(
      'ref-access',
      'Accessible entrance and step-free routes',
      'The accessible entrance is on the east side of the building, next to the taxi drop-off, with a level ramp and automatic doors. Lifts to every floor are behind registration. Main Hall, Room 3 and Room 4 are step-free. Room 2 is reached by stairs only.',
      ['accessible', 'accessibility', 'entrance', 'wheelchair', 'ramp', 'lift', 'elevator', 'step-free', 'stairs'],
      { categories: ['ACCESSIBILITY'] },
    ),
    doc(
      'ref-food',
      'Food, coffee and dietary needs',
      'Coffee is served all day in the Atrium. Lunch runs from 12:30 to 14:00 UTC in the Atrium, with vegetarian, vegan, halal and gluten-free options labelled at each counter. Ask any catering staff member about allergens.',
      ['food', 'lunch', 'coffee', 'eat', 'drink', 'vegan', 'vegetarian', 'halal', 'gluten', 'allergy', 'allergen', 'catering', 'water'],
    ),
    doc(
      'ref-toilets',
      'Toilets and quiet room',
      'Toilets are on every floor beside the lifts, including accessible toilets with baby-changing facilities. A quiet room for prayer or rest is on the first floor opposite Room 4.',
      ['toilet', 'toilets', 'restroom', 'bathroom', 'washroom', 'quiet', 'prayer', 'rest', 'baby'],
    ),
    doc(
      'ref-badge',
      'Badges, registration and lost property',
      'Registration and badge reprints are at the desk in the ground-floor lobby, open 08:00 to 18:00 UTC. Lost property is held at the same desk. Badges must be worn to enter session rooms.',
      ['badge', 'registration', 'register', 'lost', 'property', 'found', 'reprint', 'ticket', 'desk'],
    ),
    doc(
      'ref-emergency',
      'Emergencies and first aid',
      'In an emergency, tell the nearest staff member or call the venue control room on extension 999 from any house phone. First aid is next to registration and is staffed all day. If you hear the alarm, leave by the nearest marked exit and gather at the assembly point in the front plaza. Do not use the lifts.',
      ['emergency', 'first', 'aid', 'medical', 'fire', 'alarm', 'evacuate', 'evacuation', 'injury', 'injured', 'unwell', 'faint', 'assembly'],
    ),
    doc(
      'ref-transport',
      'Getting here and leaving',
      'The nearest metro station is a five-minute walk from the main entrance. Taxis and ride-share pick-ups use the east drop-off next to the accessible entrance. There is no public parking at the venue.',
      ['metro', 'train', 'taxi', 'uber', 'transport', 'parking', 'park', 'bus', 'station', 'airport', 'leave'],
    ),
    doc(
      'ref-proc-av',
      'Staff procedure: AV faults',
      'Check the receiver pack and battery first, then swap to the spare handheld microphone kept in each room cabinet. If the projector has no signal, reseat the HDMI cable at the lectern and press Source. Escalate to the AV lead if not fixed within 10 minutes.',
      ['microphone', 'mic', 'audio', 'sound', 'projector', 'hdmi', 'screen', 'av', 'speaker'],
      { categories: ['AV'], audience: 'STAFF' },
    ),
    doc(
      'ref-proc-capacity',
      'Staff procedure: overcrowded rooms',
      'Stop admitting people at the door once a room reaches its posted capacity. Direct attendees to the overflow stream in the Atrium and to sessions with free seats. Room moves need an organiser approval in HELLO; never move a session on your own.',
      ['crowded', 'overcrowded', 'capacity', 'full', 'overflow', 'door', 'seats'],
      { categories: ['CAPACITY'], audience: 'STAFF' },
    ),
  ];
}

/** Demo profiles: written as plain text here, sealed with the runtime's vault before they reach the store. */
const DEMO_PROFILES: Array<{ userId: string; headline: string; bio: string; visibility: ProfileVisibility }> = [
  { userId: DEMO_USERS.attendeeAda, headline: 'Satellite power engineer (fictional)', bio: 'Here for the satellite power and robotics sessions. Happy to talk solar arrays.', visibility: 'EVENT' },
  { userId: DEMO_USERS.attendeeBen, headline: 'Security researcher (fictional)', bio: 'Zero trust, event networks, and anything with a threat model.', visibility: 'EVENT' },
  { userId: DEMO_USERS.attendeeChloe, headline: 'Edge computing lead (fictional)', bio: 'Uses a wheelchair; ask me about step-free venues done right.', visibility: 'CONNECTIONS' },
  { userId: DEMO_USERS.attendeeDev, headline: 'Ground-station developer (fictional)', bio: 'Building satellite communication links. Looking for collaborators.', visibility: 'EVENT' },
  { userId: DEMO_USERS.speakerInes, headline: 'Speaker: Satellite Power Systems (fictional)', bio: 'Speaking at 13:00 in Room 3. Slides will be shared with followers afterwards.', visibility: 'EVENT' },
];

const DEMO_FOLLOWS: Array<[string, string]> = [
  [DEMO_USERS.attendeeAda, DEMO_USERS.speakerInes],
  [DEMO_USERS.speakerInes, DEMO_USERS.attendeeAda],
  [DEMO_USERS.attendeeAda, DEMO_USERS.attendeeDev],
  [DEMO_USERS.attendeeDev, DEMO_USERS.attendeeAda],
  [DEMO_USERS.attendeeBen, DEMO_USERS.attendeeAda],
  [DEMO_USERS.attendeeChloe, DEMO_USERS.attendeeBen],
  [DEMO_USERS.attendeeDev, DEMO_USERS.speakerInes],
];

export async function loadDemoEvent(store: MemoryHelloStore, options: { vault?: Vault } = {}): Promise<void> {
  const data = buildDemoData();
  const vault = options.vault;
  store.seed({
    profiles: vault
      ? DEMO_PROFILES.map((p) => ({
          userId: p.userId,
          sealed: vault.seal(JSON.stringify({ headline: p.headline, bio: p.bio }), `profile:${p.userId}`),
          visibility: p.visibility,
          updatedAt: DEMO_T0,
        }))
      : [],
    follows: DEMO_FOLLOWS.map(([followerId, followeeId], i) => ({ followerId, followeeId, createdAt: DEMO_T0 - (i + 1) * 3_600_000 })),
    events: data.events,
    users: data.users,
    memberships: data.memberships,
    rooms: data.rooms,
    sessions: data.sessions,
    incidents: data.incidents,
    reports: data.reports,
    timeline: data.timeline,
    announcements: data.announcements,
    notifications: data.notifications,
    referenceDocs: buildReferenceDocs(DEMO_EVENT_ID, DEMO_T0),
    venues: [buildDemoVenue(DEMO_EVENT_ID)],
  });
  for (const approval of data.approvals) {
    await store.insertApproval(approval);
  }
}

export const DEMO_NOW = DEMO_T0 + 3 * HOUR;
