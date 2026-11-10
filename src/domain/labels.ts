import type { DataSource, IncidentCategory, IncidentStatus } from './types';

/** Plain display text shared by server and client code. Kept free of service imports so client bundles stay small. */

export const STATUS_LABEL: Record<IncidentStatus, string> = {
  REPORTED: 'Reported',
  TRIAGED: 'Triaged, waiting for an assignee',
  ASSIGNED: 'Assigned',
  ACKNOWLEDGED: 'Acknowledged',
  IN_PROGRESS: 'In progress',
  RESOLVED: 'Marked resolved, awaiting your confirmation',
  CONFIRMED: 'Confirmed by the reporter',
  CLOSED: 'Closed',
  REOPENED: 'Reopened',
  CANCELLED: 'Cancelled',
  NEEDS_INFORMATION: 'Needs more information',
  ESCALATED: 'Escalated',
};

export const DATA_SOURCE_LABEL: Record<DataSource, string> = {
  LIVE_VERIFIED: 'Live, verified',
  ADMIN_ENTERED: 'Entered by an administrator',
  REPORTED_BY_ATTENDEES: 'Reported by attendees (not a measurement)',
  DEMO_SEED: 'Demo data (illustrative)',
};

/** Verb shown on the button that moves an incident into `status`. */
export const ACTION_LABEL: Partial<Record<IncidentStatus, string>> = {
  TRIAGED: 'Return to triage',
  ACKNOWLEDGED: 'Acknowledge',
  IN_PROGRESS: 'Start work',
  RESOLVED: 'Mark resolved',
  NEEDS_INFORMATION: 'Request information',
  ESCALATED: 'Escalate',
  CANCELLED: 'Cancel incident',
  CONFIRMED: 'Confirm it is fixed',
  REOPENED: 'Reopen',
};

export const CATEGORY_LABEL: Record<IncidentCategory, string> = {
  AV: 'AV',
  CAPACITY: 'Capacity',
  ACCESSIBILITY: 'Accessibility',
  FACILITIES: 'Facilities',
  SCHEDULE: 'Schedule',
  GENERAL: 'General',
};
