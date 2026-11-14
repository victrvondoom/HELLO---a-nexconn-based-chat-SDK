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
];
