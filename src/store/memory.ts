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
  Room,
  Session,
  SignalPattern,
  User,
} from '../domain/types';
import type { Venue } from '../domain/venue/types';
import { OPEN_STATUSES } from '../domain/incidents/lifecycle';
import { DomainError } from '../domain/errors';
import { VersionConflictError, type HelloStore } from './store';

/**
 * In-memory implementation of `HelloStore`. Used for local demo mode and for tests.
 *
 * Values are cloned on the way in and out, so a caller can never change stored
 * state by mutating an object it received. Every write is synchronous inside the
 * method, which makes each method atomic within a single Node process. It is NOT
 * durable and NOT shared across processes: production must use the Postgres
 * implementation described in docs/database.md.
 */
export class MemoryHelloStore implements HelloStore {
  private events = new Map<string, EventRecord>();
  private users = new Map<string, User>();
  private memberships = new Map<string, Membership>();
  private rooms = new Map<string, Room>();
  private sessions = new Map<string, Session>();
  private messages: Message[] = [];
  private incidents = new Map<string, Incident>();
  private reports: IncidentReport[] = [];
  private timeline: IncidentTimelineEntry[] = [];
  private approvals = new Map<string, ApprovalRequest>();
  private announcements: Announcement[] = [];
  private audit: AuditEntry[] = [];
  private notifications: Notification[] = [];
  private notificationKeys = new Set<string>();
  private patterns = new Map<string, SignalPattern>();
  private referenceDocs: ReferenceDoc[] = [];
  private venues = new Map<string, Venue>();
  private profiles = new Map<string, ProfileRecord>();
  private follows: Follow[] = [];
  private keyBundles: KeyBundle[] = [];
  private sealed: SealedMessage[] = [];

  private static copy<T>(value: T): T {
    return structuredClone(value);
  }

  private static copyAll<T>(values: Iterable<T>): T[] {
    return [...values].map((v) => structuredClone(v));
  }

  // --- seeding helpers (used by the seed loader only) ---

  seed(data: {
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
  }): void {
    for (const p of data.profiles ?? []) this.profiles.set(p.userId, MemoryHelloStore.copy(p));
    for (const f of data.follows ?? []) this.follows.push(MemoryHelloStore.copy(f));
    for (const v of data.venues ?? []) this.venues.set(v.eventId, MemoryHelloStore.copy(v));
    for (const d of data.referenceDocs ?? []) this.referenceDocs.push(MemoryHelloStore.copy(d));
    for (const a of data.announcements ?? []) this.announcements.push(MemoryHelloStore.copy(a));
    for (const n of data.notifications ?? []) {
      this.notifications.push(MemoryHelloStore.copy(n));
      this.notificationKeys.add(`${n.eventId}::${n.dedupeKey}`);
    }
    for (const e of data.events) this.events.set(e.id, MemoryHelloStore.copy(e));
    for (const u of data.users) this.users.set(u.id, MemoryHelloStore.copy(u));
    for (const m of data.memberships) this.memberships.set(m.id, MemoryHelloStore.copy(m));
    for (const r of data.rooms) this.rooms.set(r.id, MemoryHelloStore.copy(r));
    for (const s of data.sessions) this.sessions.set(s.id, MemoryHelloStore.copy(s));
    for (const i of data.incidents ?? []) this.incidents.set(i.id, MemoryHelloStore.copy(i));
    for (const r of data.reports ?? []) this.reports.push(MemoryHelloStore.copy(r));
    for (const t of data.timeline ?? []) this.timeline.push(MemoryHelloStore.copy(t));
  }

  // --- events, users, memberships ---

  async getEvent(eventId: string): Promise<EventRecord | null> {
    const e = this.events.get(eventId);
    return e ? MemoryHelloStore.copy(e) : null;
  }

  async getUser(userId: string): Promise<User | null> {
    const u = this.users.get(userId);
    return u ? MemoryHelloStore.copy(u) : null;
  }

  async listUsers(): Promise<User[]> {
    return MemoryHelloStore.copyAll(this.users.values());
  }

  async updateUser(userId: string, patch: Partial<Pick<User, 'displayName' | 'interests' | 'discoverable' | 'accessibilityRequired'>>): Promise<User> {
    const current = this.users.get(userId);
    if (!current) {
      throw new DomainError('NOT_FOUND', 'User not found.');
    }
    const next = { ...current, ...patch };
    this.users.set(userId, next);
    return MemoryHelloStore.copy(next);
  }

  async listMembershipsOfUser(userId: string): Promise<Membership[]> {
    return MemoryHelloStore.copyAll([...this.memberships.values()].filter((m) => m.userId === userId));
  }

  async findMembership(eventId: string, userId: string): Promise<Membership | null> {
    for (const m of this.memberships.values()) {
      if (m.eventId === eventId && m.userId === userId) {
        return MemoryHelloStore.copy(m);
      }
    }
    return null;
  }

  async listMemberships(eventId: string): Promise<Membership[]> {
    return MemoryHelloStore.copyAll([...this.memberships.values()].filter((m) => m.eventId === eventId));
  }

  async updateMembership(membershipId: string, patch: Partial<Pick<Membership, 'availability' | 'zone' | 'skills'>>): Promise<Membership> {
    const current = this.memberships.get(membershipId);
    if (!current) {
      throw new DomainError('NOT_FOUND', 'Membership not found.');
    }
    const next = { ...current, ...patch };
    this.memberships.set(membershipId, next);
    return MemoryHelloStore.copy(next);
  }

  // --- rooms & sessions ---

  async listRooms(eventId: string): Promise<Room[]> {
    return MemoryHelloStore.copyAll([...this.rooms.values()].filter((r) => r.eventId === eventId));
  }

  async getRoom(roomId: string): Promise<Room | null> {
    const r = this.rooms.get(roomId);
    return r ? MemoryHelloStore.copy(r) : null;
  }

  async listSessions(eventId: string): Promise<Session[]> {
    return MemoryHelloStore.copyAll([...this.sessions.values()].filter((s) => s.eventId === eventId));
  }

  async getSession(sessionId: string): Promise<Session | null> {
    const s = this.sessions.get(sessionId);
    return s ? MemoryHelloStore.copy(s) : null;
  }

  async updateSession(sessionId: string, patch: Partial<Pick<Session, 'roomId'>>): Promise<void> {
    const existing = this.sessions.get(sessionId);
    if (!existing) {
      throw new DomainError('NOT_FOUND', 'Session not found.');
    }
    this.sessions.set(sessionId, { ...existing, ...patch });
  }

  // --- messages ---

  async insertMessage(message: Message): Promise<void> {
    this.messages.push(MemoryHelloStore.copy(message));
  }

  async listMessages(eventId: string): Promise<Message[]> {
    return MemoryHelloStore.copyAll(this.messages.filter((m) => m.eventId === eventId));
  }

  // --- incidents (optimistic concurrency) ---

  async insertIncident(incident: Incident): Promise<void> {
    if (this.incidents.has(incident.id)) {
      throw new DomainError('VALIDATION_FAILED', `Incident ${incident.id} already exists.`);
    }
    this.incidents.set(incident.id, MemoryHelloStore.copy(incident));
  }

  async getIncident(incidentId: string): Promise<Incident | null> {
    const i = this.incidents.get(incidentId);
    return i ? MemoryHelloStore.copy(i) : null;
  }

  async listIncidents(eventId: string): Promise<Incident[]> {
    return MemoryHelloStore.copyAll([...this.incidents.values()].filter((i) => i.eventId === eventId));
  }

  async updateIncident(
    incidentId: string,
    expectedVersion: number,
    patch: Partial<Incident>,
    now: number,
  ): Promise<Incident> {
    const current = this.incidents.get(incidentId);
    if (!current) {
      throw new DomainError('NOT_FOUND', 'Incident not found.');
    }
    if (current.version !== expectedVersion) {
      throw new VersionConflictError('incident');
    }
    const next: Incident = { ...current, ...patch, version: current.version + 1, updatedAt: now };
    this.incidents.set(incidentId, next);
    return MemoryHelloStore.copy(next);
  }

  // --- reports ---

  async insertReport(report: IncidentReport): Promise<void> {
    this.reports.push(MemoryHelloStore.copy(report));
  }

  async listReportsForEvent(eventId: string): Promise<IncidentReport[]> {
    return MemoryHelloStore.copyAll(this.reports.filter((r) => r.eventId === eventId));
  }

  async listReportsForIncident(incidentId: string): Promise<IncidentReport[]> {
    return MemoryHelloStore.copyAll(this.reports.filter((r) => r.incidentId === incidentId));
  }

  // --- timeline & audit ---

  async appendTimeline(entry: IncidentTimelineEntry): Promise<void> {
    this.timeline.push(MemoryHelloStore.copy(entry));
  }

  async listTimeline(incidentId: string): Promise<IncidentTimelineEntry[]> {
    return MemoryHelloStore.copyAll(
      this.timeline.filter((t) => t.incidentId === incidentId).sort((a, b) => a.at - b.at),
    );
  }

  async appendAudit(entry: AuditEntry): Promise<void> {
    this.audit.push(MemoryHelloStore.copy(entry));
  }

  async listAudit(eventId: string): Promise<AuditEntry[]> {
    return MemoryHelloStore.copyAll(this.audit.filter((a) => a.eventId === eventId));
  }

  // --- approvals ---

  async insertApproval(approval: ApprovalRequest): Promise<void> {
    if (this.approvals.has(approval.id)) {
      throw new DomainError('VALIDATION_FAILED', `Approval ${approval.id} already exists.`);
    }
    this.approvals.set(approval.id, MemoryHelloStore.copy(approval));
  }

  async getApproval(approvalId: string): Promise<ApprovalRequest | null> {
    const a = this.approvals.get(approvalId);
    return a ? MemoryHelloStore.copy(a) : null;
  }

  async listApprovals(eventId: string): Promise<ApprovalRequest[]> {
    return MemoryHelloStore.copyAll([...this.approvals.values()].filter((a) => a.eventId === eventId));
  }

  async updateApproval(
    approvalId: string,
    expectedVersion: number,
    patch: Partial<ApprovalRequest>,
  ): Promise<ApprovalRequest> {
    const current = this.approvals.get(approvalId);
    if (!current) {
      throw new DomainError('NOT_FOUND', 'Approval not found.');
    }
    if (current.version !== expectedVersion) {
      throw new VersionConflictError('approval request');
    }
    const next: ApprovalRequest = { ...current, ...patch, version: current.version + 1 };
    this.approvals.set(approvalId, next);
    return MemoryHelloStore.copy(next);
  }

  // --- announcements ---

  async insertAnnouncement(announcement: Announcement): Promise<void> {
    this.announcements.push(MemoryHelloStore.copy(announcement));
  }

  async listAnnouncements(eventId: string): Promise<Announcement[]> {
    return MemoryHelloStore.copyAll(
      this.announcements.filter((a) => a.eventId === eventId).sort((a, b) => b.publishedAt - a.publishedAt),
    );
  }

  // --- notifications ---

  async insertNotificationIfNew(notification: Notification): Promise<boolean> {
    const scoped = `${notification.eventId}::${notification.dedupeKey}`;
    if (this.notificationKeys.has(scoped)) {
      return false;
    }
    this.notificationKeys.add(scoped);
    this.notifications.push(MemoryHelloStore.copy(notification));
    return true;
  }

  async markNotificationsRead(recipientUserId: string, eventId: string, now: number): Promise<number> {
    let changed = 0;
    this.notifications = this.notifications.map((n) => {
      if (n.recipientUserId === recipientUserId && n.eventId === eventId && n.readAt === null) {
        changed += 1;
        return { ...n, readAt: now };
      }
      return n;
    });
    return changed;
  }

  async listNotifications(recipientUserId: string): Promise<Notification[]> {
    return MemoryHelloStore.copyAll(
      this.notifications
        .filter((n) => n.recipientUserId === recipientUserId)
        .sort((a, b) => b.createdAt - a.createdAt),
    );
  }

  // --- signal intelligence ---

  async upsertSignalPatterns(patterns: SignalPattern[]): Promise<void> {
    for (const incoming of patterns) {
      const existing = this.patterns.get(incoming.id);
      // Human review is never overwritten by a recomputation.
      const merged: SignalPattern = existing && existing.reviewStatus !== 'PENDING_REVIEW'
        ? { ...incoming, reviewStatus: existing.reviewStatus, reviewedByUserId: existing.reviewedByUserId, reviewedAt: existing.reviewedAt }
        : incoming;
      this.patterns.set(incoming.id, MemoryHelloStore.copy(merged));
    }
  }

  // --- social graph ---

  async getProfile(userId: string): Promise<ProfileRecord | null> {
    const p = this.profiles.get(userId);
    return p ? MemoryHelloStore.copy(p) : null;
  }

  async putProfile(profile: ProfileRecord): Promise<void> {
    this.profiles.set(profile.userId, MemoryHelloStore.copy(profile));
  }

  async deleteProfile(userId: string): Promise<void> {
    this.profiles.delete(userId);
  }

  async addFollow(follow: Follow): Promise<boolean> {
    if (this.follows.some((f) => f.followerId === follow.followerId && f.followeeId === follow.followeeId)) return false;
    this.follows.push(MemoryHelloStore.copy(follow));
    return true;
  }

  async removeFollow(followerId: string, followeeId: string): Promise<boolean> {
    const before = this.follows.length;
    this.follows = this.follows.filter((f) => !(f.followerId === followerId && f.followeeId === followeeId));
    return this.follows.length !== before;
  }

  async listFollowers(userId: string): Promise<Follow[]> {
    return MemoryHelloStore.copyAll(this.follows.filter((f) => f.followeeId === userId));
  }

  async listFollowing(userId: string): Promise<Follow[]> {
    return MemoryHelloStore.copyAll(this.follows.filter((f) => f.followerId === userId));
  }

  async removeAllFollows(userId: string): Promise<number> {
    const before = this.follows.length;
    this.follows = this.follows.filter((f) => f.followerId !== userId && f.followeeId !== userId);
    return before - this.follows.length;
  }

  // --- end-to-end encrypted messages ---

  async putKeyBundle(bundle: KeyBundle): Promise<void> {
    if (this.keyBundles.some((k) => k.id === bundle.id)) return;
    this.keyBundles.push(MemoryHelloStore.copy(bundle));
  }

  async listKeyBundles(userId: string): Promise<KeyBundle[]> {
    return MemoryHelloStore.copyAll(this.keyBundles.filter((k) => k.userId === userId).sort((a, b) => a.createdAt - b.createdAt));
  }

  async deleteKeyBundles(userId: string): Promise<number> {
    const before = this.keyBundles.length;
    this.keyBundles = this.keyBundles.filter((k) => k.userId !== userId);
    return before - this.keyBundles.length;
  }

  async insertSealedMessage(message: SealedMessage): Promise<void> {
    this.sealed.push(MemoryHelloStore.copy(message));
  }

  async listSealedBetween(a: string, b: string): Promise<SealedMessage[]> {
    return MemoryHelloStore.copyAll(
      this.sealed
        .filter((m) => (m.senderId === a && m.recipientId === b) || (m.senderId === b && m.recipientId === a))
        .sort((x, y) => x.createdAt - y.createdAt),
    );
  }

  async listSealedInvolving(userId: string): Promise<SealedMessage[]> {
    return MemoryHelloStore.copyAll(this.sealed.filter((m) => m.senderId === userId || m.recipientId === userId));
  }

  async deleteSealedInvolving(userId: string): Promise<number> {
    const before = this.sealed.length;
    this.sealed = this.sealed.filter((m) => m.senderId !== userId && m.recipientId !== userId);
    return before - this.sealed.length;
  }

  // --- rights ---

  async redactMessagesFrom(userId: string, replacement: string): Promise<number> {
    let n = 0;
    for (const m of this.messages) {
      if (m.senderUserId !== userId) continue;
      m.text = replacement;
      m.interpretation = null;
      n += 1;
    }
    return n;
  }

  async redactReportsFrom(userId: string, replacement: string): Promise<number> {
    let n = 0;
    for (const r of this.reports) {
      if (r.reporterUserId !== userId) continue;
      r.text = replacement;
      n += 1;
    }
    return n;
  }

  async getVenue(eventId: string): Promise<Venue | null> {
    const v = this.venues.get(eventId);
    return v ? MemoryHelloStore.copy(v) : null;
  }

  async listReferenceDocs(eventId: string): Promise<ReferenceDoc[]> {
    return MemoryHelloStore.copyAll(this.referenceDocs.filter((d) => d.eventId === eventId));
  }

  async listSignalPatterns(eventId: string): Promise<SignalPattern[]> {
    return MemoryHelloStore.copyAll([...this.patterns.values()].filter((p) => p.eventId === eventId));
  }

  async getSignalPattern(patternId: string): Promise<SignalPattern | null> {
    const p = this.patterns.get(patternId);
    return p ? MemoryHelloStore.copy(p) : null;
  }

  async updateSignalPattern(patternId: string, patch: Partial<SignalPattern>): Promise<SignalPattern> {
    const current = this.patterns.get(patternId);
    if (!current) {
      throw new DomainError('NOT_FOUND', 'Signal pattern not found.');
    }
    const next = { ...current, ...patch };
    this.patterns.set(patternId, next);
    return MemoryHelloStore.copy(next);
  }

  async countOpenAssignments(eventId: string): Promise<Map<string, number>> {
    const counts = new Map<string, number>();
    for (const incident of this.incidents.values()) {
      if (incident.eventId !== eventId || incident.assigneeUserId === null) continue;
      if (!OPEN_STATUSES.includes(incident.status)) continue;
      counts.set(incident.assigneeUserId, (counts.get(incident.assigneeUserId) ?? 0) + 1);
    }
    return counts;
  }
}
