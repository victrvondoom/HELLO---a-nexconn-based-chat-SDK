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
  Room,
  Session,
  SignalPattern,
  User,
} from '../domain/types';
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

  upsertSignalPatterns(patterns: SignalPattern[]): Promise<void>;
  listSignalPatterns(eventId: string): Promise<SignalPattern[]>;
  getSignalPattern(patternId: string): Promise<SignalPattern | null>;
  updateSignalPattern(patternId: string, patch: Partial<SignalPattern>): Promise<SignalPattern>;

  /** Number of open (not closed/cancelled) incidents each user is assigned to. */
  countOpenAssignments(eventId: string): Promise<Map<string, number>>;
}

export class VersionConflictError extends DomainError {
  constructor(entity: string) {
    super('VERSION_CONFLICT', `The ${entity} was changed by someone else. Refresh and try again.`);
  }
}
