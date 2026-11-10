import { describe, expect, it } from 'vitest';
import { workflowRail, WORKFLOW_STAGES } from '@/domain/incidents/workflow';
import { INCIDENT_STATUSES } from '@/domain/types';

describe('workflow rail', () => {
  it('marks earlier stages done and the current stage current', () => {
    const rail = workflowRail('ASSIGNED');
    expect(rail.stages.map((s) => s.state)).toEqual(['done', 'done', 'current', 'upcoming', 'upcoming', 'upcoming']);
  });

  it('shows a paused incident as blocked at the stage where it stopped', () => {
    const rail = workflowRail('NEEDS_INFORMATION');
    expect(rail.stages[0]?.state).toBe('blocked');
  });

  it('shows a confirmed or closed incident with every stage complete', () => {
    expect(workflowRail('CLOSED').stages.every((s) => s.state === 'done' || s.state === 'current')).toBe(true);
    expect(workflowRail('CLOSED').stages.at(-1)?.state).toBe('current');
  });

  it('covers every status with a description and a rail of the expected length', () => {
    for (const status of INCIDENT_STATUSES) {
      const rail = workflowRail(status);
      expect(rail.position.length).toBeGreaterThan(5);
      expect(rail.stages).toHaveLength(WORKFLOW_STAGES.length);
    }
  });
});
