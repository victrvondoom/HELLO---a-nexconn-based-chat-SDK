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
}

export type MediaKind = 'IMAGE' | 'VIDEO';

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
  /** Set when this post shares another post. */
  repostOf: string | null;
  likes: string[];
  createdAt: number;
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
  chatLinks: ChatLink;
  chatLinkCodes: ChatLinkCode;
  chatInbound: ChatInbound;
  chatDeliveries: ChatDelivery;
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
  'chatLinks',
  'chatLinkCodes',
  'chatInbound',
  'chatDeliveries',
];
