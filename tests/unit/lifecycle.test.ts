import { throwsCode } from '../helpers/errors';
import { describe, expect, it } from 'vitest';
import { allowedNextStatuses, assertTransition, canTransition, isOpen, TRANSITIONS } from '@/domain/incidents/lifecycle';
import { INCIDENT_STATUSES } from '@/domain/types';

describe('incident lifecycle', () => {
  it('allows the core path from triage to closure through the right actors', () => {
    expect(canTransition('REPORTED', 'TRIAGED', ['SYSTEM'])).toBe(true);
    expect(canTransition('TRIAGED', 'ASSIGNED', ['STAFF'])).toBe(true);
    expect(canTransition('ASSIGNED', 'ACKNOWLEDGED', ['ASSIGNEE'])).toBe(true);
    expect(canTransition('ACKNOWLEDGED', 'IN_PROGRESS', ['ASSIGNEE'])).toBe(true);
    expect(canTransition('IN_PROGRESS', 'RESOLVED', ['ASSIGNEE'])).toBe(true);
    expect(canTransition('RESOLVED', 'CONFIRMED', ['REPORTER'])).toBe(true);
    expect(canTransition('CONFIRMED', 'CLOSED', ['SYSTEM'])).toBe(true);
  });

  it('rejects skipped steps', () => {
    throwsCode(() => { assertTransition('TRIAGED', 'RESOLVED', ['ASSIGNEE', 'STAFF', 'OPERATIONS']); }, 'INVALID_TRANSITION');
    throwsCode(() => { assertTransition('REPORTED', 'CLOSED', ['SYSTEM']); }, 'INVALID_TRANSITION');
  });

  it('enforces who may move an incident, not just where it can go', () => {
    // A staff member who is not the assignee cannot resolve someone else's work.
    throwsCode(() => { assertTransition('IN_PROGRESS', 'RESOLVED', ['STAFF']); }, 'FORBIDDEN');
    // A reporter cannot claim work.
    throwsCode(() => { assertTransition('TRIAGED', 'ASSIGNED', ['REPORTER']); }, 'FORBIDDEN');
  });

  it('keeps CANCELLED terminal and only reopens closed work', () => {
    expect(TRANSITIONS.CANCELLED).toEqual({});
    expect(allowedNextStatuses('CLOSED')).toEqual(['REOPENED']);
    expect(canTransition('CLOSED', 'REOPENED', ['REPORTER'])).toBe(true);
  });

  it('defines an entry for every status so no state is orphaned', () => {
    for (const status of INCIDENT_STATUSES) {
      expect(TRANSITIONS[status]).toBeDefined();
    }
  });

  it('treats only unfinished statuses as open', () => {
    expect(isOpen('TRIAGED')).toBe(true);
    expect(isOpen('REOPENED')).toBe(true);
    expect(isOpen('CLOSED')).toBe(false);
    expect(isOpen('CANCELLED')).toBe(false);
    expect(isOpen('CONFIRMED')).toBe(false);
  });
});
