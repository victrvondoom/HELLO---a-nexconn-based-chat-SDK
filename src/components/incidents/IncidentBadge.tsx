import type { IncidentStatus } from '@/domain/types';
import { statusTone } from '@/components/ui/labels';

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

export function IncidentBadge({ status }: { status: IncidentStatus }) {
  const tone = statusTone(status);
  const className = tone ? `badge badge--${tone}` : 'badge';
  return <span className={className}>{SHORT[status]}</span>;
}
