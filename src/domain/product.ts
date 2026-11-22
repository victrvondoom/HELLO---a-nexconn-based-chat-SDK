import type { AttemptStatus, Difficulty, LevelDefinition, MissionCategory, MissionStatus } from './field/rules';

/**
 * Records for the product modules: accounts, the social feed, communities, live location, calls,
 * games, workflows and access tokens. They live in typed document collections (see HelloStore.doc*).
 * Every record has a string `id`, and every event-scoped record carries its `eventId`, so a read can
 * always be scoped to the event the viewer belongs to.
 */

export interface AuthAccount {
  /** The handle, lower case. Using it as the id makes "one account per handle" a storage guarantee. */
  id: string;
  /** The user this account signs in as. */
  userId: string;
  /** scrypt, never the password. Format: scrypt$N$salt$hash (base64url). */
  passwordHash: string;
  createdAt: number;
}

export interface SessionRecord {
  /** SHA-256 of the cookie token. The token itself is never stored. */
  id: string;
  userId: string;
  createdAt: number;
  expiresAt: number;
}

export type TokenScope = 'READ' | 'WRITE';

export interface ApiToken {
  id: string;
  userId: string;
  eventId: string;
  name: string;
  /** SHA-256 of the token. The token is shown once, when it is created. */
  hash: string;
  scope: TokenScope;
  createdAt: number;
  lastUsedAt: number | null;
}

export interface UserPrefs {
  /** The user id. */
  id: string;
  /** ISO 3166-1 numeric code, as used by the world map. Null when not declared. */
  country: string | null;
  /** Field Atlas leaderboard: shown by name only when the person opted in. Absent means no. */
  leaderboard?: boolean;
}

export type MediaKind = 'IMAGE' | 'VIDEO';

/**
 * Moments: stories, saves and highlights (rules in src/domain/moments). The lists are the source of the
 * types, so a schema, the seed and the UI cannot drift apart. Backdrops are named swatches, never colours
 * a person types, so a post or story cannot carry arbitrary styling.
 */
export const BACKDROPS = ['meadow', 'sky', 'dusk', 'sun', 'night', 'clover'] as const;
export type Backdrop = (typeof BACKDROPS)[number];
/** Reaction ids are sent to Nexconn as `reactionId`, which is limited to 16 characters. */
export const REACTION_IDS = ['heart', 'fire', 'clap', 'laugh', 'wow', 'sprout'] as const;
export type ReactionId = (typeof REACTION_IDS)[number];
export type StoryKind = 'TEXT' | 'IMAGE' | 'VIDEO';
export type StoryAudience = 'EVENT' | 'FOLLOWERS';

export interface Story {
  id: string;
  eventId: string;
  authorId: string;
  kind: StoryKind;
  text: string;
  backdrop: Backdrop;
  mediaId: string | null;
  /** A space on the venue map the story is about. Chosen by the author, never read from a device. */
  spaceId: string | null;
  audience: StoryAudience;
  createdAt: number;
  /** createdAt + 24 hours. After this the story is deleted, unless it is in a highlight. */
  expiresAt: number;
  /** First view per person. The author's own views are not recorded. */
  views: Array<{ userId: string; at: number }>;
  /** One per person; a new reaction replaces the old one. */
  reactions: Array<{ userId: string; reactionId: ReactionId; at: number }>;
}

/** Stories the author chose to keep on their profile after the 24 hours. */
export interface StoryHighlight {
  id: string;
  eventId: string;
  ownerId: string;
  title: string;
  storyIds: string[];
  createdAt: number;
  updatedAt: number;
}

export interface SavedPost {
  /** `${userId}:${postId}`, so saving twice cannot store two records. */
  id: string;
  eventId: string;
  userId: string;
  postId: string;
  createdAt: number;
}

export interface MediaMeta {
  id: string;
  eventId: string;
  ownerId: string;
  kind: MediaKind;
  mime: string;
  size: number;
  createdAt: number;
}

export interface Post {
  id: string;
  eventId: string;
  authorId: string;
  communityId: string | null;
  text: string;
  mediaId: string | null;
  mediaKind: MediaKind | null;
  /** A text post drawn on a backdrop. Posts stored before Moments have no field: read it as `p.backdrop ?? null`. */
  backdrop: Backdrop | null;
  /** Set when this post shares another post. */
  repostOf: string | null;
  likes: string[];
  /** A poll attached to the post. Posts written before polls have no field: read it as `p.poll ?? null`. */
  poll?: Poll | null;
  createdAt: number;
}

/** A question's answers. `votes` maps a person to the option they chose; it is never shown to anyone as such. */
export interface Poll {
  options: Array<{ id: string; label: string }>;
  closesAt: number;
  votes: Record<string, string>;
}

export interface PostComment {
  id: string;
  eventId: string;
  postId: string;
  authorId: string;
  text: string;
  createdAt: number;
}

export interface Community {
  id: string;
  eventId: string;
  name: string;
  description: string;
  /** Optional home country (ISO numeric), shown on the world map. */
  country: string | null;
  ownerId: string;
  memberIds: string[];
  createdAt: number;
}

export type LocationAudience = 'CONNECTIONS' | 'EVENT';

export interface LocationShare {
  /** `${eventId}:${userId}`: one live location per person per event. */
  id: string;
  eventId: string;
  userId: string;
  audience: LocationAudience;
  /** True when the coordinates were rounded to about a kilometre before being stored. */
  approximate: boolean;
  /** Coordinates sealed with the server vault. */
  sealed: string;
  updatedAt: number;
  expiresAt: number;
}

export interface CallParticipant {
  userId: string;
  peerId: string;
  joinedAt: number;
  seenAt: number;
}

export interface CallSignal {
  seq: number;
  to: string;
  from: string;
  data: string;
}

/**
 * Privacy filter (integrated from Offleak, see docs/UPSTREAM_INTEGRATION_AUDIT.md): one person's switches, global
 * across events. It never holds an image or face data; the people kept visible stay on the person's own device.
 * The id is the user id.
 */
export interface PrivacyFilterRecord {
  id: string;
  userId: string;
  enabled: boolean;
  fps: number;
  delay: number;
  faceEnabled: boolean;
  qrEnabled: boolean;
  phoneEnabled: boolean;
  /** Added after the first release: absent on older records, which then use the defaults. */
  peopleEnabled?: boolean;
  screensEnabled?: boolean;
  effect?: 'pixelate' | 'blur' | 'blackout';
  updatedAt: number;
}

/** Where a privacy alert came from: a call host or moderator in HELLO, or `!privacy` in the person's Twitch chat. */
export type PrivacyAlertSource = 'CALL' | 'TWITCH';

/** "Check your frame": raised for one person by someone allowed to, delivered only to that person. */
export interface PrivacyAlert {
  id: string;
  eventId: string;
  recipientUserId: string;
  /** Null for Twitch alerts (the sender is a Twitch account) and after the sender's erasure. */
  senderUserId: string | null;
  senderName: string;
  source: PrivacyAlertSource;
  callId: string | null;
  createdAt: number;
  acknowledgedAt: number | null;
}

export interface CallRoom {
  id: string;
  eventId: string;
  title: string;
  hostId: string;
  communityId: string | null;
  createdAt: number;
  endedAt: number | null;
  participants: CallParticipant[];
  signals: CallSignal[];
  seq: number;
}

export interface QuizQuestion {
  prompt: string;
  options: string[];
  answer: number;
}

export type GameStatus = 'WAITING' | 'ACTIVE' | 'WON' | 'DRAW' | 'FINISHED';

export interface Game {
  id: string;
  eventId: string;
  kind: 'FOUR' | 'QUIZ';
  createdBy: string;
  status: GameStatus;
  createdAt: number;
  updatedAt: number;
  /** FOUR: the two seats. QUIZ: everyone who answered. */
  players: string[];
  /** FOUR: 42 cells, row-major from the top. 0 empty, 1 first seat, 2 second seat. */
  board: number[];
  turn: number;
  winnerId: string | null;
  line: number[];
  /** QUIZ only. */
  questions: QuizQuestion[];
  answers: Record<string, number[]>;
}

export type RunStatus = 'SUCCEEDED' | 'FAILED';

export interface WorkflowRun {
  id: string;
  eventId: string;
  workflowId: string;
  actorId: string;
  /** How the run was started: from the canvas, or by an external client through MCP. */
  via: 'CANVAS' | 'MCP';
  status: RunStatus;
  startedAt: number;
  steps: Array<{ label: string; status: RunStatus; detail: string }>;
}

/** Field Atlas records. See src/domain/field/rules.ts for the invariants. */
export interface FieldSeason {
  id: string;
  eventId: string;
  year: number;
  month: number;
  title: string;
  theme: string;
  description: string;
  startsAt: number;
  endsAt: number;
  /** The artwork key the badge cabinet draws. */
  artwork: 'compass' | 'route' | 'hands' | 'lens' | 'bridge';
  bonusXp: number;
  /** Missions in the season. The badge is earned when every one in `requiredMissionIds` is approved in-window. */
  missionIds: string[];
  requiredMissionIds: string[];
  status: 'DRAFT' | 'PUBLISHED' | 'PAUSED';
  source: 'ORGANISER' | 'QUEST_DIRECTOR' | 'DEMO_SEED';
  version: number;
  createdAt: number;
  updatedAt: number;
}

export interface FieldMission {
  id: string;
  eventId: string;
  title: string;
  description: string;
  whyItMatters: string;
  category: MissionCategory;
  difficulty: Difficulty;
  requiredLevel: number;
  xp: number;
  seasonId: string | null;
  spaceId: string | null;
  nonLocation: boolean;
  prerequisiteIds: string[];
  verification:
    | { method: 'WORKFLOW_RUN'; workflowId: string }
    | { method: 'CHECK_IN'; stationId: string }
    | { method: 'MANUAL_REVIEW'; evidencePrompt: string };
  estimateMinutes: number | null;
  accessibilityNote: string;
  startsAt: number | null;
  endsAt: number | null;
  status: MissionStatus;
  maxCompletionsPerPerson: 1;
  source: 'ORGANISER' | 'QUEST_DIRECTOR' | 'DEMO_SEED';
  version: number;
  createdAt: number;
  updatedAt: number;
}

/** One per person per mission. Id is `${missionId}:${userId}`, so a second start cannot be stored. */
export interface FieldAttempt {
  id: string;
  eventId: string;
  missionId: string;
  userId: string;
  status: AttemptStatus;
  submissions: number;
  evidenceText: string;
  normalisedEvidence: string;
  /** The last verification reason shown to the person, for failed or pending steps. */
  lastOutcome: string;
  startedAt: number;
  submittedAt: number | null;
  approvedAt: number | null;
  reviewedBy: string | null;
  version: number;
}

/** Append-only XP ledger. Id is deterministic (source-derived), so a repeat write is a no-op. */
export interface FieldLedgerEntry {
  id: string;
  eventId: string;
  userId: string;
  amount: number;
  kind: 'MISSION' | 'SEASON_BONUS' | 'ADJUSTMENT';
  sourceId: string;
  reason: string;
  actorId: string | null;
  createdAt: number;
}

/** Earned badges. Id is `${userId}:${badgeId}`. Never deleted by season expiry. */
export interface FieldBadge {
  id: string;
  eventId: string;
  userId: string;
  badgeId: string;
  kind: 'PERMANENT' | 'MONTHLY';
  seasonId: string | null;
  name: string;
  artwork: string;
  earnedAt: number;
}

/** A staff-issued check-in code for one place. Only a hash is stored. */
export interface FieldStation {
  id: string;
  eventId: string;
  spaceId: string;
  name: string;
  codeHash: string;
  codeIssuedAt: number;
  codeExpiresAt: number;
  rotations: number;
  createdBy: string;
  version: number;
}

export interface FieldFlag {
  id: string;
  eventId: string;
  userId: string | null;
  missionId: string | null;
  kind: 'REPEATED_SUBMISSIONS' | 'DUPLICATE_EVIDENCE' | 'EXPIRED_CHECK_IN' | 'REPEATED_BAD_CODE';
  detail: string;
  status: 'OPEN' | 'DISMISSED';
  createdAt: number;
}

export interface FieldLevelConfig {
  /** One document per event. The list is the whole progression for that event. */
  id: string;
  eventId: string;
  levels: LevelDefinition[];
  version: number;
  updatedAt: number;
}

export interface QuestRun {
  id: string;
  eventId: string;
  createdAt: number;
  createdBy: string;
  /** The inputs the draft was built from, by id, so the draft can be traced to real records. */
  sources: { sessionIds: string[]; roomIds: string[]; spaceIds: string[]; workflowIds: string[] };
  /** Counts of what the generator could not ground, so it reports gaps instead of inventing them. */
  unavailable: string[];
  missionIds: string[];
  autoPublished: string[];
  status: 'DRAFT_CREATED' | 'REJECTED_ALL';
}

// ---------- LiveScene and LiveShield (src/domain/live, src/services/live.ts) ----------

/**
 * A report made from the venue map, about a place rather than a person's position. It is not an incident:
 * it becomes one only when a staff member promotes it. It expires after its category's time to live.
 */
export interface LiveReport {
  id: string;
  eventId: string;
  reporterUserId: string;
  category: 'SAFETY' | 'TECHNICAL' | 'CROWD' | 'SOCIAL' | 'COMMUNITY' | 'ACCESSIBILITY';
  /** A venue space chosen by the reporter. Never a device position. */
  spaceId: string;
  /** The zone the space belongs to, copied at report time so later renames cannot rewrite history. */
  zone: string;
  text: string;
  /** Set when the Sentinel found an emergency word in the text. Routes the report to the moderation queue. */
  safetySignal: 'MEDICAL' | 'FIRE' | 'SECURITY' | null;
  /**
   * OPEN: live. PROMOTING: a staff member is opening an incident (a short lock). PROMOTED: an incident exists,
   * and `incidentId` names it. DISMISSED: a staff member reviewed it and removed it from the live view.
   */
  status: 'OPEN' | 'PROMOTING' | 'PROMOTED' | 'DISMISSED';
  incidentId: string | null;
  createdAt: number;
  expiresAt: number;
  decisionByUserId: string | null;
  decidedAt: number | null;
  decisionReason: string | null;
  version: number;
}

export type HoldScope = { kind: 'EVENT' } | { kind: 'ZONE'; zone: string } | { kind: 'REPORT'; reportId: string };

/**
 * A safety hold suspends the public live layer for a scope. It never touches private messages or
 * unrelated communities. It stays in force until a different organiser releases it: `decisionDueAt`
 * only marks it overdue, so visibility is never restored by the clock alone.
 */
export interface SafetyHold {
  id: string;
  eventId: string;
  scope: HoldScope;
  reason: string;
  placedByUserId: string;
  placedAt: number;
  decisionDueAt: number;
  status: 'IN_FORCE' | 'RELEASED';
  releasedByUserId: string | null;
  releasedAt: number | null;
  releaseReason: string | null;
  version: number;
}

// ---------- HELLO Living Atlas: personal place memory (src/domain/places, src/services/places.ts) ----------

export type PlaceStatus = 'SAVED' | 'WANT_TO_VISIT' | 'VISITED';
export type PlaceCategory = 'FOOD' | 'COFFEE' | 'SHOP' | 'CULTURE' | 'OUTDOORS' | 'TRANSPORT' | 'SERVICE' | 'WORK' | 'OTHER';
/** Where the place came from: typed by the person, picked from the venue, found in their text, a link, an import, or a photo's location. */
export type PlaceSource = 'MANUAL' | 'VENUE_MAP' | 'MESSAGE' | 'LINK' | 'IMPORT' | 'PHOTO';

/**
 * A place in one person's private memory, scoped to one event. Only its owner can read or change it. The
 * private note is sealed at rest with the server vault; it is never returned to anyone but the owner.
 */
export interface SavedPlace {
  id: string;
  eventId: string;
  ownerId: string;
  name: string;
  description: string;
  category: PlaceCategory;
  /** A venue space on this event's map, when the place is inside the venue. */
  spaceId: string | null;
  /** Coordinates the owner typed in. Both null, or both set. Never read from a device. */
  latitude: number | null;
  longitude: number | null;
  address: string | null;
  status: PlaceStatus;
  favourite: boolean;
  /** 1 to 5, or null when not rated. */
  rating: number | null;
  /** Sealed with the vault. The plaintext exists only in the owner's own responses. */
  privateNoteSealed: string;
  collectionIds: string[];
  tags: string[];
  source: { type: PlaceSource; reference: string | null };
  visibility: 'PRIVATE';
  createdAt: number;
  updatedAt: number;
  /** How many times the owner has changed it. The history is the timestamps and this count, not a copy of each value. */
  updates: number;
  version: number;
}

export interface PlaceCollection {
  id: string;
  eventId: string;
  ownerId: string;
  name: string;
  createdAt: number;
  version: number;
}

/**
 * A visit the person recorded themselves: a check-in at a venue space. There is no background detection; a visit
 * exists only because the person chose to record it, and they can correct or delete it.
 */
export interface PlaceVisit {
  id: string;
  eventId: string;
  ownerId: string;
  spaceId: string;
  placeId: string | null;
  arrivedAt: number;
  departedAt: number | null;
  method: 'CHECK_IN';
  correctedAt: number | null;
  version: number;
}

/** One import of a file into My places: what was read, what was saved, and the rows that could not be read. */
export interface PlaceImport {
  id: string;
  eventId: string;
  ownerId: string;
  fileName: string;
  format: 'CSV' | 'GEOJSON';
  total: number;
  saved: number;
  skipped: number;
  failures: Array<{ line: number; reason: string }>;
  createdAt: number;
  version: number;
}

// ---------- chat gateway (src/services/chat-gateway.ts) ----------

/**
 * A person's account on an external chat network (Nexconn, or any network behind the signed webhook
 * transport), linked by a one-time code the person sent from that account. One link per external account.
 */
export interface ChatLink {
  /** `${transport}:${externalUserId}` */
  id: string;
  transport: string;
  externalUserId: string;
  userId: string;
  eventId: string;
  createdAt: number;
}

/** A one-time link code. Only its hash is stored; it expires after ten minutes and works once. */
export interface ChatLinkCode {
  /** SHA-256 of the code. */
  id: string;
  userId: string;
  eventId: string;
  createdAt: number;
  expiresAt: number;
}

/** An inbound message already handled, so a retried webhook gets the same reply and nothing runs twice. */
export interface ChatInbound {
  /** `${transport}:${messageId}` */
  id: string;
  transport: string;
  /** PROCESSING while the first copy runs, so a duplicate arriving at the same moment does not run it again. */
  state: 'PROCESSING' | 'DONE';
  userId: string | null;
  reply: string;
  receivedAt: number;
}

/** One notification to deliver to one linked chat account: the outbox the delivery worker drains. */
export interface ChatDelivery {
  id: string;
  eventId: string;
  recipientUserId: string;
  transport: string;
  externalUserId: string;
  body: string;
  href: string;
  createdAt: number;
  status: 'PENDING' | 'SENDING' | 'DELIVERED' | 'FAILED';
  attempts: number;
  nextAttemptAt: number;
  /** While SENDING: when another worker may take it over (the first one crashed or hung). */
  leaseUntil: number | null;
  lastError: string | null;
  deliveredAt: number | null;
  /** The transport's own reference for the delivered message. */
  reference: string | null;
}


// --- Kingdoms: a persistent shared world an event's people live in (src/domain/kingdom, src/services/kingdoms.ts) ---
export interface Kingdom {
  id: string;
  eventId: string;
  /** The monarch. Only they, or content moderators, may govern it. */
  ownerId: string;
  name: string;
  motto: string;
  /** Seeds the terrain and the street plan. The world is derived from it, never stored tile by tile. */
  seed: number;
  /** When false, nobody new can become a citizen. Existing citizens are unaffected. */
  openGates: boolean;
  /** Next never-used lot. Lots are handed out in street-plan order. */
  nextLot: number;
  /** Lots given back by citizens who left, handed out again before nextLot. */
  freeLots: number[];
  version: number;
  createdAt: number;
}

export interface KingdomCitizen {
  /** `${kingdomId}:${userId}` so a person is a citizen once. */
  id: string;
  kingdomId: string;
  eventId: string;
  userId: string;
  name: string;
  title: string;
  /** Index of the lot in the street plan. Fixed for life, so a home never moves. */
  lot: number;
  /** The citizen's own name for their home, and the roof they chose. Absent until they customise it. */
  homeName?: string;
  roof?: string;
  x: number;
  z: number;
  joinedAt: number;
  movedAt: number;
  banned: boolean;
}

export type KingdomChronicleKind = 'FOUNDED' | 'CITIZEN_JOINED' | 'CITIZEN_LEFT' | 'DECREE' | 'FORGED' | 'CARAVAN' | 'CHEER' | 'BANISHED' | 'PARDONED';

export interface KingdomChronicle {
  id: string;
  kingdomId: string;
  eventId: string;
  kind: KingdomChronicleKind;
  /** Null for events with no person behind them, or after erasure. */
  actorId: string | null;
  text: string;
  /** Where in the world it happened, when it did. */
  at: number;
  x: number | null;
  z: number | null;
}

export type KingdomForgeStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

/** A citizen's request to add something to the world. Deterministic kit, no model: see domain/kingdom/forge.ts. */
export interface KingdomForge {
  id: string;
  kingdomId: string;
  eventId: string;
  requesterId: string;
  prompt: string;
  kit: string;
  colour: string;
  status: KingdomForgeStatus;
  decidedBy: string | null;
  decisionNote: string;
  x: number;
  z: number;
  createdAt: number;
  decidedAt: number | null;
}

/** A pin on a custom map, placed in fractions of the picture (0..1), so it stays put at any size. */
export interface CustomMapPin {
  id: string;
  x: number;
  y: number;
  label: string;
  kind: 'PLACE' | 'EXIT' | 'MEET' | 'HELP';
}

/**
 * A map a person made for an event: their own picture, a frame from a video, or a sketch, with labelled pins.
 * Private to its owner until they share it with the event.
 */
export interface CustomMap {
  id: string;
  eventId: string;
  ownerId: string;
  name: string;
  mediaId: string;
  source: 'IMAGE' | 'VIDEO_FRAME' | 'SKETCH';
  shared: boolean;
  pins: CustomMapPin[];
  createdAt: number;
  updatedAt: number;
}

export interface Collections {
  accounts: AuthAccount;
  authSessions: SessionRecord;
  apiTokens: ApiToken;
  prefs: UserPrefs;
  media: MediaMeta;
  posts: Post;
  comments: PostComment;
  communities: Community;
  locations: LocationShare;
  calls: CallRoom;
  games: Game;
  workflowRuns: WorkflowRun;
  fieldSeasons: FieldSeason;
  fieldMissions: FieldMission;
  fieldAttempts: FieldAttempt;
  fieldLedger: FieldLedgerEntry;
  fieldBadges: FieldBadge;
  fieldStations: FieldStation;
  fieldFlags: FieldFlag;
  fieldLevels: FieldLevelConfig;
  questRuns: QuestRun;
  stories: Story;
  storyHighlights: StoryHighlight;
  savedPosts: SavedPost;
  chatLinks: ChatLink;
  chatLinkCodes: ChatLinkCode;
  chatInbound: ChatInbound;
  chatDeliveries: ChatDelivery;
  liveReports: LiveReport;
  safetyHolds: SafetyHold;
  places: SavedPlace;
  placeCollections: PlaceCollection;
  placeVisits: PlaceVisit;
  placeImports: PlaceImport;
  privacyFilters: PrivacyFilterRecord;
  privacyAlerts: PrivacyAlert;
  kingdoms: Kingdom;
  kingdomCitizens: KingdomCitizen;
  kingdomChronicle: KingdomChronicle;
  kingdomForges: KingdomForge;
  customMaps: CustomMap;
}

export type CollectionName = keyof Collections;

export const COLLECTION_NAMES: readonly CollectionName[] = [
  'accounts',
  'authSessions',
  'apiTokens',
  'prefs',
  'media',
  'posts',
  'comments',
  'communities',
  'locations',
  'calls',
  'games',
  'workflowRuns',
  'fieldSeasons',
  'fieldMissions',
  'fieldAttempts',
  'fieldLedger',
  'fieldBadges',
  'fieldStations',
  'fieldFlags',
  'fieldLevels',
  'questRuns',
  'stories',
  'storyHighlights',
  'savedPosts',
  'chatLinks',
  'chatLinkCodes',
  'chatInbound',
  'chatDeliveries',
  'liveReports',
  'safetyHolds',
  'places',
  'placeCollections',
  'placeVisits',
  'placeImports',
  'privacyFilters',
  'privacyAlerts',
  'kingdoms',
  'kingdomCitizens',
  'kingdomChronicle',
  'kingdomForges',
  'customMaps',
];
