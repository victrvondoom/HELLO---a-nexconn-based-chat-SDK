import type { IncidentStatus } from '@/domain/types';

const SHORT: Record<IncidentStatus, string> = {
  REPORTED: 'Reported',
  TRIAGED: 'Triaged',
  ASSIGNED: 'Assigned',
  ACKNOWLEDGED: 'Acknowledged',
  IN_PROGRESS: 'In progress',
  RESOLVED: 'Resolved',
  CONFIRMED: 'Confirmed',
  CLOSED: 'Closed',
  REOPENED: 'Reopened',
  CANCELLED: 'Cancelled',
  NEEDS_INFORMATION: 'Needs info',
  ESCALATED: 'Escalated',
};

/** The Meadow status palette: new is sky, in hand is sun, done is grass, needs rescue is poppy, cancelled is neutral. */
const TONE: Record<IncidentStatus, string> = {
  REPORTED: 'badge badge--sky',
  TRIAGED: 'badge badge--sky',
  ASSIGNED: 'badge badge--warning',
  ACKNOWLEDGED: 'badge badge--warning',
  IN_PROGRESS: 'badge badge--warning',
  NEEDS_INFORMATION: 'badge badge--sun',
  RESOLVED: 'badge badge--success',
  CONFIRMED: 'badge badge--success',
  CLOSED: 'badge badge--success',
  REOPENED: 'badge badge--danger',
  ESCALATED: 'badge badge--danger',
  CANCELLED: 'badge',
};

export function IncidentBadge({ status }: { status: IncidentStatus }) {
  return <span className={TONE[status]}>{SHORT[status]}</span>;
}
