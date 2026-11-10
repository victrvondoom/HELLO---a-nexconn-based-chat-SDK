import type { DataSource, IncidentStatus, Role, Urgency } from '@/domain/types';
import { DATA_SOURCE_LABEL, STATUS_LABEL } from '@/domain/labels';

export const ROLE_LABEL: Record<Role, string> = {
  ATTENDEE: 'Attendee',
  SPEAKER: 'Speaker',
  VOLUNTEER: 'Volunteer',
  OPERATIONS_STAFF: 'Operations',
  ORGANISER: 'Organiser',
  PLATFORM_ADMIN: 'Platform admin',
};

export const URGENCY_LABEL: Record<Urgency, string> = {
  LOW: 'Low',
  MEDIUM: 'Medium',
  HIGH: 'High',
  CRITICAL: 'Critical',
};

export function statusTone(status: IncidentStatus): 'accent' | 'danger' | 'warning' | 'success' | '' {
  switch (status) {
    case 'CLOSED':
    case 'CONFIRMED':
      return 'success';
    case 'REOPENED':
    case 'ESCALATED':
      return 'danger';
    case 'NEEDS_INFORMATION':
    case 'REPORTED':
      return 'warning';
    case 'IN_PROGRESS':
    case 'ACKNOWLEDGED':
    case 'ASSIGNED':
      return 'accent';
    default:
      return '';
  }
}

export function statusText(status: IncidentStatus): string {
  return STATUS_LABEL[status];
}

export function sourceText(source: DataSource): string {
  return DATA_SOURCE_LABEL[source];
}

export function formatUtc(ms: number): string {
  return `${new Date(ms).toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

export function minutesAgo(now: number, then: number): string {
  const minutes = Math.max(0, Math.round((now - then) / 60000));
  return minutes === 0 ? 'just now' : `${minutes} min ago`;
}
