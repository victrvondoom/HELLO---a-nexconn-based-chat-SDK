/**
 * Core domain types for HELLO.
 *
 * These describe persisted state. They are deliberately plain: no behaviour,
 * no framework types. Business rules live in the sibling domain modules.
 */

export const ROLES = [
  'ATTENDEE',
  'SPEAKER',
  'VOLUNTEER',
  'OPERATIONS_STAFF',
  'ORGANISER',
  'PLATFORM_ADMIN',
] as const;
export type Role = (typeof ROLES)[number];

export const STAFF_ROLES: readonly Role[] = ['VOLUNTEER', 'OPERATIONS_STAFF', 'ORGANISER'];

export const INCIDENT_CATEGORIES = [
  'AV',
  'CAPACITY',
  'ACCESSIBILITY',
  'FACILITIES',
  'SCHEDULE',
  'GENERAL',
] as const;
export type IncidentCategory = (typeof INCIDENT_CATEGORIES)[number];

export const INCIDENT_STATUSES = [
  'REPORTED',
  'TRIAGED',
  'ASSIGNED',
  'ACKNOWLEDGED',
  'IN_PROGRESS',
  'RESOLVED',
  'CONFIRMED',
  'CLOSED',
  'REOPENED',
  'CANCELLED',
  'NEEDS_INFORMATION',
  'ESCALATED',
] as const;
export type IncidentStatus = (typeof INCIDENT_STATUSES)[number];

export type Urgency = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

/** Where a number or fact came from. Shown in the UI so demo data is never mistaken for live data. */
export type DataSource = 'LIVE_VERIFIED' | 'ADMIN_ENTERED' | 'REPORTED_BY_ATTENDEES' | 'DEMO_SEED';

export type AvailabilityState = 'AVAILABLE' | 'BUSY' | 'OFF_SHIFT';

export interface User {
  id: string;
  displayName: string;
  /** Declared interests / expertise, used only for matching the user's own requests. */
  interests: string[];
  /** Whether the person has consented to appear in people discovery. */
  discoverable: boolean;
  /** Set when the user needs step-free / accessible routes or seating. */
  accessibilityRequired: boolean;
}

export interface EventRecord {
  id: string;
  name: string;
  timezone: string;
  /** True when the event was created by the demo seed, never by a real organiser. */
  isDemo: boolean;
}

export interface Membership {
  id: string;
  eventId: string;
  userId: string;
  role: Role;
  /** Operational capabilities (e.g. "AV", "ACCESSIBILITY", "FACILITIES"). Used for assignment matching. */
  skills: string[];
  availability: AvailabilityState;
  /** Zone the staff member is normally stationed in. Used for location scoring. */
  zone: string | null;
}

export interface Room {
  id: string;
  eventId: string;
  name: string;
  zone: string;
  capacity: number;
  accessible: boolean;
  /** Equipment installed in the room, e.g. "microphone", "projector". */
  equipment: string[];
  /** Latest occupancy figure and its provenance. Null when nothing has been reported. */
  occupancy: number | null;
  occupancySource: DataSource | null;
}

export interface Session {
  id: string;
  eventId: string;
  title: string;
  topics: string[];
  roomId: string;
  startsAt: number;
  endsAt: number;
  capacity: number;
  enrolled: number;
  accessible: boolean;
  speakerUserId: string | null;
}

export interface Announcement {
  id: string;
  eventId: string;
  title: string;
  body: string;
  publishedByUserId: string;
  publishedAt: number;
}

export interface Incident {
  id: string;
  eventId: string;
  category: IncidentCategory;
  status: IncidentStatus;
  urgency: Urgency;
  title: string;
  roomId: string | null;
  sessionId: string | null;
  equipment: string[];
  createdByUserId: string;
  assigneeUserId: string | null;
  /** Optimistic-concurrency counter. Every write must match the version it read. */
  version: number;
  createdAt: number;
  updatedAt: number;
  acknowledgedAt: number | null;
  resolvedAt: number | null;
  confirmedAt: number | null;
  resolutionNote: string | null;
}

/** One person's report. Several reports can attach to one incident; each keeps its own record. */
export interface IncidentReport {
  id: string;
  incidentId: string;
  eventId: string;
  reporterUserId: string;
  text: string;
  createdAt: number;
  matchConfidence: number;
  matchSignals: string[];
}

export interface IncidentTimelineEntry {
  id: string;
  incidentId: string;
  eventId: string;
  type: 'CREATED' | 'REPORT_ATTACHED' | 'STATUS_CHANGED' | 'ASSIGNED' | 'ASSIGNMENT_RECOMMENDED' | 'NOTE' | 'APPROVAL_REQUESTED';
  actorUserId: string | null;
  fromStatus: IncidentStatus | null;
  toStatus: IncidentStatus | null;
  detail: string;
  at: number;
}

export interface Message {
  id: string;
  eventId: string;
  senderUserId: string;
  text: string;
  createdAt: number;
  /** Structured interpretation attached to the message, if any. */
  interpretation: Record<string, unknown> | null;
  /** Linked workflow objects created from this message. */
  linkedIncidentId: string | null;
  linkedApprovalId: string | null;
}

export const CONSEQUENTIAL_ACTION_TYPES = [
  'MOVE_SESSION_ROOM',
  'PUBLISH_ANNOUNCEMENT',
  'CANCEL_SESSION',
  'REASSIGN_STAFF',
] as const;
export type ConsequentialActionType = (typeof CONSEQUENTIAL_ACTION_TYPES)[number];

export type ApprovalStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXPIRED';
export type ExecutionStatus = 'NOT_STARTED' | 'SUCCEEDED' | 'FAILED';

export interface ApprovalRequest {
  id: string;
  eventId: string;
  actionType: ConsequentialActionType;
  payload: Record<string, string>;
  justification: string;
  requestedByUserId: string;
  status: ApprovalStatus;
  expiresAt: number;
  decidedByUserId: string | null;
  decidedAt: number | null;
  decisionReason: string | null;
  /** Execution is recorded separately from approval: an approved action may still fail. */
  executionStatus: ExecutionStatus;
  executionResult: string | null;
  executedAt: number | null;
  linkedIncidentId: string | null;
  version: number;
}

export interface AuditEntry {
  id: string;
  eventId: string;
  actorUserId: string | null;
  action: string;
  targetType: string;
  targetId: string;
  detail: string;
  at: number;
}

export interface Notification {
  id: string;
  eventId: string;
  recipientUserId: string;
  kind: string;
  body: string;
  /** Where clicking the notification should take the user, e.g. /events/x/incidents/y. */
  href: string;
  dedupeKey: string;
  createdAt: number;
  /** Null until the recipient marks it read. */
  readAt: number | null;
}

export interface SignalPattern {
  id: string;
  eventId: string;
  scope: { roomId: string | null; category: IncidentCategory };
  windowStart: number;
  windowEnd: number;
  distinctReporters: number;
  reportIds: string[];
  incidentIds: string[];
  confidence: number;
  explanation: string;
  recommendation: string;
  reviewStatus: 'PENDING_REVIEW' | 'ACCEPTED' | 'REJECTED';
  reviewedByUserId: string | null;
  reviewedAt: number | null;
}
