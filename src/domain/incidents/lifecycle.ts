import { DomainError } from '../errors';
import type { IncidentStatus } from '../types';

/**
 * Who is attempting a transition. The service layer works out the actor kind from
 * the membership and the incident, then asks this module whether it is allowed.
 */
export type TransitionActor =
  | 'ASSIGNEE' // the staff member currently assigned to the incident
  | 'STAFF' // any operational staff member (volunteer, operations, organiser)
  | 'OPERATIONS' // operations staff or organiser
  | 'REPORTER' // a person who reported this incident
  | 'SYSTEM'; // automated, deterministic follow-ups (e.g. closing a confirmed incident)

type Edges = Partial<Record<IncidentStatus, readonly TransitionActor[]>>;

/**
 * The legal state machine. Anything not listed here is rejected on the server.
 * CANCELLED is terminal. CLOSED can only be re-entered through REOPENED.
 */
export const TRANSITIONS: Record<IncidentStatus, Edges> = {
  REPORTED: {
    TRIAGED: ['OPERATIONS', 'SYSTEM'],
    NEEDS_INFORMATION: ['OPERATIONS', 'SYSTEM'],
    CANCELLED: ['OPERATIONS', 'REPORTER'],
  },
  NEEDS_INFORMATION: {
    TRIAGED: ['OPERATIONS', 'REPORTER', 'SYSTEM'],
    CANCELLED: ['OPERATIONS', 'REPORTER'],
  },
  TRIAGED: {
    ASSIGNED: ['STAFF'],
    ESCALATED: ['STAFF'],
    NEEDS_INFORMATION: ['OPERATIONS'],
    CANCELLED: ['OPERATIONS'],
  },
  ASSIGNED: {
    ACKNOWLEDGED: ['ASSIGNEE'],
    ESCALATED: ['STAFF'],
    TRIAGED: ['OPERATIONS'],
    CANCELLED: ['OPERATIONS'],
  },
  ACKNOWLEDGED: {
    IN_PROGRESS: ['ASSIGNEE'],
    ESCALATED: ['STAFF'],
    CANCELLED: ['OPERATIONS'],
  },
  IN_PROGRESS: {
    RESOLVED: ['ASSIGNEE'],
    NEEDS_INFORMATION: ['ASSIGNEE'],
    ESCALATED: ['STAFF'],
    CANCELLED: ['OPERATIONS'],
  },
  ESCALATED: {
    TRIAGED: ['OPERATIONS'],
    ASSIGNED: ['STAFF'],
    CANCELLED: ['OPERATIONS'],
  },
  RESOLVED: {
    CONFIRMED: ['REPORTER'],
    REOPENED: ['REPORTER', 'OPERATIONS'],
  },
  CONFIRMED: {
    CLOSED: ['SYSTEM'],
    REOPENED: ['REPORTER'],
  },
  CLOSED: {
    REOPENED: ['REPORTER', 'OPERATIONS'],
  },
  REOPENED: {
    TRIAGED: ['OPERATIONS', 'SYSTEM'],
    ESCALATED: ['STAFF'],
    CANCELLED: ['OPERATIONS'],
  },
  CANCELLED: {},
};

export function canTransition(
  from: IncidentStatus,
  to: IncidentStatus,
  actors: readonly TransitionActor[],
): boolean {
  const allowed = TRANSITIONS[from][to];
  if (!allowed) {
    return false;
  }
  return actors.some((actor) => allowed.includes(actor));
}

/** Throws `INVALID_TRANSITION` unless the state machine permits `from → to` for one of `actors`. */
export function assertTransition(
  from: IncidentStatus,
  to: IncidentStatus,
  actors: readonly TransitionActor[],
): void {
  if (!TRANSITIONS[from][to]) {
    throw new DomainError('INVALID_TRANSITION', `An incident cannot move from ${from} to ${to}.`);
  }
  if (!canTransition(from, to, actors)) {
    throw new DomainError('FORBIDDEN', `Your role cannot move this incident from ${from} to ${to}.`);
  }
}

export function allowedNextStatuses(from: IncidentStatus): IncidentStatus[] {
  return Object.keys(TRANSITIONS[from]) as IncidentStatus[];
}

/** Statuses that count as "still being handled" for duplicate matching and open-work metrics. */
export const OPEN_STATUSES: readonly IncidentStatus[] = [
  'REPORTED',
  'TRIAGED',
  'ASSIGNED',
  'ACKNOWLEDGED',
  'IN_PROGRESS',
  'ESCALATED',
  'NEEDS_INFORMATION',
  'REOPENED',
];

export function isOpen(status: IncidentStatus): boolean {
  return OPEN_STATUSES.includes(status);
}
