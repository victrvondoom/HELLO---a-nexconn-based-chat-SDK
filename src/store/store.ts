import type {
  Announcement,
  ApprovalRequest,
  AuditEntry,
  EventRecord,
  Incident,
  IncidentReport,
  IncidentTimelineEntry,
  Membership,
  Message,
  Notification,
  ReferenceDoc,
  ProfileRecord,
  Follow,
  KeyBundle,
  SealedMessage,
  Payment,
  Room,
  Session,
  SignalPattern,
  User,
} from '../domain/types';
import type { Venue } from '../domain/venue/types';
import type { CollectionName, Collections } from '../domain/product';
import { DomainError } from '../domain/errors';

/**
 * Persistence boundary used by every service.
 *
 * Methods are async so a Postgres (Supabase) implementation can satisfy the same
 * contract. Every method that changes an incident or approval takes the version
 * the caller read; if the stored version differs the write is rejected with
 * VERSION_CONFLICT. That is how two staff members cannot both claim one incident.
 */
export interface HelloStore {
  getEvent(eventId: string): Promise<EventRecord | null>;
  getUser(userId: string): Promise<User | null>;
  listUsers(): Promise<User[]>;
  updateUser(userId: string, patch: Partial<Pick<User, 'displayName' | 'interests' | 'discoverable' | 'accessibilityRequired'>>): Promise<User>;

  findMembership(eventId: string, userId: string): Promise<Membership | null>;
  listMemberships(eventId: string): Promise<Membership[]>;
  /** Every event a person belongs to. Used by data export and erasure. */
  listMembershipsOfUser(userId: string): Promise<Membership[]>;
  updateMembership(membershipId: string, patch: Partial<Pick<Membership, 'availability' | 'zone' | 'skills'>>): Promise<Membership>;

  listRooms(eventId: string): Promise<Room[]>;
  getRoom(roomId: string): Promise<Room | null>;

  listSessions(eventId: string): Promise<Session[]>;
  getSession(sessionId: string): Promise<Session | null>;
  updateSession(sessionId: string, patch: Partial<Pick<Session, 'roomId'>>): Promise<void>;

  insertMessage(message: Message): Promise<void>;
  listMessages(eventId: string): Promise<Message[]>;

  insertIncident(incident: Incident): Promise<void>;
  getIncident(incidentId: string): Promise<Incident | null>;
  listIncidents(eventId: string): Promise<Incident[]>;
  /** Writes only if the stored version equals `expectedVersion`. Increments the version. */
  updateIncident(incidentId: string, expectedVersion: number, patch: Partial<Incident>, now: number): Promise<Incident>;

  insertReport(report: IncidentReport): Promise<void>;
  listReportsForEvent(eventId: string): Promise<IncidentReport[]>;
  listReportsForIncident(incidentId: string): Promise<IncidentReport[]>;

  appendTimeline(entry: IncidentTimelineEntry): Promise<void>;
  listTimeline(incidentId: string): Promise<IncidentTimelineEntry[]>;

  insertApproval(approval: ApprovalRequest): Promise<void>;
  getApproval(approvalId: string): Promise<ApprovalRequest | null>;
  listApprovals(eventId: string): Promise<ApprovalRequest[]>;
  updateApproval(approvalId: string, expectedVersion: number, patch: Partial<ApprovalRequest>): Promise<ApprovalRequest>;

  insertAnnouncement(announcement: Announcement): Promise<void>;
  listAnnouncements(eventId: string): Promise<Announcement[]>;

  appendAudit(entry: AuditEntry): Promise<void>;
  listAudit(eventId: string): Promise<AuditEntry[]>;

  /** Inserts the notification only if its dedupe key is new for the event. Returns true if inserted. */
  insertNotificationIfNew(notification: Notification): Promise<boolean>;
  listNotifications(recipientUserId: string): Promise<Notification[]>;
  /** Marks the recipient's notifications in an event as read. Returns how many changed. */
  markNotificationsRead(recipientUserId: string, eventId: string, now: number): Promise<number>;
  /** Erasure: deletes every notification addressed to the person, and their dedupe keys. Returns how many. */
  deleteNotificationsFor(recipientUserId: string): Promise<number>;

  // --- social graph (global, not per event: connections outlive an event) ---
  getProfile(userId: string): Promise<ProfileRecord | null>;
  putProfile(profile: ProfileRecord): Promise<void>;
  deleteProfile(userId: string): Promise<void>;
  /** Returns false when the follow already existed. */
  addFollow(follow: Follow): Promise<boolean>;
  removeFollow(followerId: string, followeeId: string): Promise<boolean>;
  listFollowers(userId: string): Promise<Follow[]>;
  listFollowing(userId: string): Promise<Follow[]>;
  removeAllFollows(userId: string): Promise<number>;

  // --- end-to-end encrypted messages: the store only ever sees public keys and ciphertext ---
  putKeyBundle(bundle: KeyBundle): Promise<void>;
  listKeyBundles(userId: string): Promise<KeyBundle[]>;
  deleteKeyBundles(userId: string): Promise<number>;
  /** Removes one device key. Used when a person has published more devices than the limit allows. */
  deleteKeyBundle(id: string): Promise<boolean>;
  insertSealedMessage(message: SealedMessage): Promise<void>;
  listSealedBetween(a: string, b: string): Promise<SealedMessage[]>;
  listSealedInvolving(userId: string): Promise<SealedMessage[]>;
  deleteSealedInvolving(userId: string): Promise<number>;

  // --- payments: version-checked so a double tap cannot charge twice ---
  insertPayment(payment: Payment): Promise<void>;
  getPayment(paymentId: string): Promise<Payment | null>;
  updatePayment(paymentId: string, expectedVersion: number, patch: Partial<Payment>): Promise<Payment>;
  listPaymentsBetween(a: string, b: string): Promise<Payment[]>;
  listPaymentsFrom(payerId: string): Promise<Payment[]>;

  // --- rights: erasure redacts operational text but keeps the accountable record ---
  redactMessagesFrom(userId: string, replacement: string): Promise<number>;
  redactReportsFrom(userId: string, replacement: string): Promise<number>;
  /** Erasure: replaces the notes a person wrote on payments they made. The financial record itself is kept. */
  redactPaymentNotesFrom(payerId: string, replacement: string): Promise<number>;

  /** The venue map and walkable graph for an event, if one has been drawn. */
  getVenue(eventId: string): Promise<Venue | null>;

  /** Event guide pages, newest first is not guaranteed; callers rank them. */
  listReferenceDocs(eventId: string): Promise<ReferenceDoc[]>;

  upsertSignalPatterns(patterns: SignalPattern[]): Promise<void>;
  listSignalPatterns(eventId: string): Promise<SignalPattern[]>;
  getSignalPattern(patternId: string): Promise<SignalPattern | null>;
  updateSignalPattern(patternId: string, patch: Partial<SignalPattern>): Promise<SignalPattern>;

  /** Number of open (not closed/cancelled) incidents each user is assigned to. */
  countOpenAssignments(eventId: string): Promise<Map<string, number>>;

  // --- accounts: people who register join an event as attendees ---
  insertUser(user: User): Promise<void>;
  insertMembership(membership: Membership): Promise<void>;

  // --- typed document collections for the product modules (src/domain/product.ts) ---
  // `where` is an equality match on top-level fields and is only ever built by server code,
  // so a caller can never smuggle a query operator into it.
  docPut<K extends CollectionName>(collection: K, doc: Collections[K]): Promise<void>;
  /** Inserts only when no document has this id. Returns false when one already exists. */
  docPutIfAbsent<K extends CollectionName>(collection: K, doc: Collections[K]): Promise<boolean>;
  docGet<K extends CollectionName>(collection: K, id: string): Promise<Collections[K] | null>;
  docList<K extends CollectionName>(collection: K, where?: Partial<Collections[K]>): Promise<Collections[K][]>;
  docDelete(collection: CollectionName, id: string): Promise<boolean>;
  /**
   * Atomic read-modify-write. `change` receives the stored document and returns the new one, or null
   * to leave it untouched. Two simultaneous moves or likes therefore cannot overwrite each other.
   */
  docMutate<K extends CollectionName>(collection: K, id: string, change: (doc: Collections[K]) => Collections[K] | null): Promise<Collections[K] | null>;

  // --- media bytes, kept apart from their metadata ---
  blobPut(id: string, bytes: Uint8Array): Promise<void>;
  blobGet(id: string): Promise<Uint8Array | null>;
  blobDelete(id: string): Promise<void>;
}

/** Initial data for an empty store: the demo event, or a test fixture. */
export interface SeedData {
  events: EventRecord[];
  users: User[];
  memberships: Membership[];
  rooms: Room[];
  sessions: Session[];
  incidents?: Incident[];
  reports?: IncidentReport[];
  timeline?: IncidentTimelineEntry[];
  announcements?: Announcement[];
  notifications?: Notification[];
  referenceDocs?: ReferenceDoc[];
  venues?: Venue[];
  profiles?: ProfileRecord[];
  follows?: Follow[];
}

/** A store that can be loaded with seed data. Both the in-memory and the Postgres store are. */
export interface SeedableStore extends HelloStore {
  seed(data: SeedData): void | Promise<void>;
}

export class VersionConflictError extends DomainError {
  constructor(entity: string) {
    super('VERSION_CONFLICT', `The ${entity} was changed by someone else. Refresh and try again.`);
  }
}
