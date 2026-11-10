import { throwsCode } from '../helpers/errors';
import { describe, expect, it } from 'vitest';
import { authorize, roleHasCapability } from '@/domain/permissions';
import { actionLevel, assertCanDecide, assertCanExecute, requiresApproval } from '@/domain/approvals/rules';
import { DomainError } from '@/domain/errors';
import type { ApprovalRequest, Membership } from '@/domain/types';

const EVT = 'evt-a';

function member(role: Membership['role'], overrides: Partial<Membership> = {}): Membership {
  return { id: `m-${role}`, eventId: EVT, userId: `u-${role}`, role, skills: [], availability: 'AVAILABLE', zone: null, ...overrides };
}

function approval(overrides: Partial<ApprovalRequest> = {}): ApprovalRequest {
  return {
    id: 'apr-1',
    eventId: EVT,
    actionType: 'MOVE_SESSION_ROOM',
    payload: { sessionId: 's', toRoomId: 'r' },
    justification: 'test',
    requestedByUserId: 'u-OPERATIONS_STAFF',
    status: 'PENDING',
    expiresAt: 10_000,
    decidedByUserId: null,
    decidedAt: null,
    decisionReason: null,
    executionStatus: 'NOT_STARTED',
    executionResult: null,
    executedAt: null,
    linkedIncidentId: null,
    version: 0,
    ...overrides,
  };
}

describe('permissions', () => {
  it('denies attendees operational capabilities', () => {
    expect(roleHasCapability('ATTENDEE', 'incident.claim')).toBe(false);
    expect(roleHasCapability('ATTENDEE', 'approval.decide')).toBe(false);
    expect(authorize(member('ATTENDEE'), 'incident.claim', EVT)).toEqual({ allowed: false, reason: 'MISSING_CAPABILITY' });
  });

  it('allows operations staff to claim but not to decide approvals', () => {
    expect(authorize(member('OPERATIONS_STAFF'), 'incident.claim', EVT).allowed).toBe(true);
    expect(authorize(member('OPERATIONS_STAFF'), 'approval.decide', EVT).allowed).toBe(false);
  });

  it('gives organisers every event capability', () => {
    expect(authorize(member('ORGANISER'), 'approval.decide', EVT).allowed).toBe(true);
    expect(authorize(member('ORGANISER'), 'signal.review', EVT).allowed).toBe(true);
  });

  it('never lets a membership from another event grant access', () => {
    const other = member('ORGANISER', { eventId: 'evt-b' });
    expect(authorize(other, 'event.read', EVT)).toEqual({ allowed: false, reason: 'WRONG_EVENT' });
  });

  it('denies non-members outright', () => {
    expect(authorize(null, 'event.read', EVT)).toEqual({ allowed: false, reason: 'NOT_A_MEMBER' });
  });

  it('gives platform administrators no implicit read access to event operations', () => {
    expect(roleHasCapability('PLATFORM_ADMIN', 'incident.read.operational')).toBe(false);
    expect(roleHasCapability('PLATFORM_ADMIN', 'audit.read')).toBe(true);
  });
});

describe('approval rules', () => {
  it('classifies trust levels', () => {
    expect(actionLevel('FIND_ROOM')).toBe('LEVEL_1');
    expect(actionLevel('NOTIFY_VOLUNTEER')).toBe('LEVEL_2');
    expect(actionLevel('MOVE_SESSION_ROOM')).toBe('LEVEL_3');
    // Unknown actions default to the strictest level.
    expect(actionLevel('DELETE_EVERYTHING')).toBe('LEVEL_3');
    expect(requiresApproval('PUBLISH_ANNOUNCEMENT')).toBe(true);
    expect(requiresApproval('NOTIFY_VOLUNTEER')).toBe(false);
  });

  it('lets only an organiser decide, and never the person who asked', () => {
    throwsCode(() => { assertCanDecide(member('OPERATIONS_STAFF'), approval(), 0); }, 'FORBIDDEN');
    const organiser = member('ORGANISER', { userId: 'u-OPERATIONS_STAFF' });
    expect(() => {
      assertCanDecide(organiser, approval(), 0);
    }).toThrow(/cannot approve a request you submitted/);
  });

  it('refuses decisions on expired or already-decided requests', () => {
    const nadia = member('ORGANISER', { userId: 'u-nadia' });
    expect(() => { assertCanDecide(nadia, approval(), 10_000); }, 'APPROVAL_NOT_DECIDABLE');
    throwsCode(() => { assertCanDecide(nadia, approval({ status: 'APPROVED' }), 0); }, 'APPROVAL_NOT_DECIDABLE');
  });

  it('does not execute before approval and never re-runs a success', () => {
    expect(() => { assertCanExecute(approval()); }).toThrow(DomainError);
    expect(() => { assertCanExecute(approval({ status: 'APPROVED', executionStatus: 'SUCCEEDED' })); }).toThrow(
      /already been executed/,
    );
  });

  it('allows a retry after a failed execution, because failed executors change nothing', () => {
    expect(() => { assertCanExecute(approval({ status: 'APPROVED', executionStatus: 'FAILED' })); }).not.toThrow();
  });
});
