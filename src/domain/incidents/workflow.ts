import type { IncidentStatus } from '../types';

/**
 * The workflow rail is derived from an incident's current status, never stored separately, so it
 * cannot disagree with the lifecycle. Stages are what a person experiences, not every internal state.
 */
export const WORKFLOW_STAGES = ['Reported', 'Triaged', 'Assigned', 'In progress', 'Resolved', 'Confirmed'] as const;

export type StageState = 'done' | 'current' | 'upcoming' | 'blocked';

export interface WorkflowRail {
  stages: Array<{ label: string; state: StageState }>;
  /** Plain-language description of where the incident is right now. */
  position: string;
}

const CURRENT_INDEX: Partial<Record<IncidentStatus, number>> = {
  REPORTED: 0,
  NEEDS_INFORMATION: 0,
  TRIAGED: 1,
  REOPENED: 1,
  ESCALATED: 1,
  ASSIGNED: 2,
  ACKNOWLEDGED: 2,
  IN_PROGRESS: 3,
  RESOLVED: 4,
  CONFIRMED: 5,
  CLOSED: 5,
};

const BLOCKED: ReadonlySet<IncidentStatus> = new Set(['NEEDS_INFORMATION', 'ESCALATED', 'CANCELLED']);

const POSITION: Record<IncidentStatus, string> = {
  REPORTED: 'Logged, waiting to be triaged',
  TRIAGED: 'Triaged, waiting for someone to take it',
  ASSIGNED: 'Assigned, waiting to be acknowledged',
  ACKNOWLEDGED: 'Acknowledged, work is about to start',
  IN_PROGRESS: 'Being worked on',
  RESOLVED: 'Marked fixed, waiting for the reporter to confirm',
  CONFIRMED: 'Confirmed fixed by the reporter',
  CLOSED: 'Closed',
  REOPENED: 'Reopened, back in the queue',
  CANCELLED: 'Cancelled',
  NEEDS_INFORMATION: 'Paused: more information is needed',
  ESCALATED: 'Escalated, needs a coordinator',
};

export function workflowRail(status: IncidentStatus): WorkflowRail {
  const current = CURRENT_INDEX[status];
  const blocked = BLOCKED.has(status);
  const stages = WORKFLOW_STAGES.map((label, index) => {
    if (current === undefined) {
      // Cancelled: nothing is current, and the rail shows where it stopped as blocked.
      return { label, state: index === 0 ? ('blocked' as const) : ('upcoming' as const) };
    }
    if (index < current) return { label, state: 'done' as const };
    if (index === current) return { label, state: blocked ? ('blocked' as const) : ('current' as const) };
    return { label, state: 'upcoming' as const };
  });
  return { stages, position: POSITION[status] };
}
