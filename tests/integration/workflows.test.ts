import { beforeEach, describe, expect, it } from 'vitest';
import { createHarness, type Harness } from './harness';
import { handleMessage } from '@/services/pipeline';
import { claimIncident, getIncidentDetail, transitionIncident } from '@/services/incidents';
import { decideApproval, executeApproval, requestApproval } from '@/services/approvals';
import { discoverPeople } from '@/services/people';
import { refreshSignals, reviewPattern } from '@/services/signals';
import { DEMO_T0 } from '@/store/seed';
import type { IntentProvider } from '@/ai/intent';

function expectDomainError(promise: Promise<unknown>, code: string) {
  return expect(promise).rejects.toMatchObject({ code });
}

let h: Harness;
beforeEach(async () => {
  h = await createHarness();
});

describe('judge demonstration: a session is failing in real time', () => {
  it('understands a two-concern message and attaches both to the seeded evidence', async () => {
    const res = await handleMessage(h.ctx, {
      eventId: h.eventId,
      userId: h.users.attendeeAda,
      text: 'The microphone is not working, and there are too many people in Room 3.',
    });

    expect(res.interpretation.intent).toBe('REPORT_INCIDENT');
    expect(res.interpretation.source).toBe('DETERMINISTIC_FALLBACK');
    expect(res.interpretation.fallbackReason).toBe('NO_PROVIDER_CONFIGURED');
    expect(res.room).toEqual({ id: 'r-3', name: 'Room 3' });

    const av = res.incidents.find((i) => i.category === 'AV');
    const cap = res.incidents.find((i) => i.category === 'CAPACITY');
    expect(av).toMatchObject({ incidentId: 'inc-seed-av-r3', attached: true });
    expect(cap).toMatchObject({ incidentId: 'inc-seed-cap-r3', attached: true });
    expect(av?.matchConfidence).toBeGreaterThanOrEqual(0.75);
    expect(av?.matchSignals).toEqual(expect.arrayContaining(['same-room', 'same-category']));

    // Nothing is invented: the existing incidents now carry Ada's record alongside the original reporter's.
    const avReports = await h.store.listReportsForIncident('inc-seed-av-r3');
    expect(avReports.map((r) => r.reporterUserId)).toEqual(expect.arrayContaining(['u-att-fatima', 'u-att-ada']));
  });

  it('recommends alternatives that exclude the full session and the current session', async () => {
    const res = await handleMessage(h.ctx, {
      eventId: h.eventId,
      userId: h.users.attendeeAda,
      text: 'There are too many people in Room 3.',
    });
    const ids = res.alternatives?.recommendations.map((r) => r.sessionId) ?? [];
    expect(ids).not.toContain('s-sat-power');
    expect(ids.length).toBeGreaterThan(0);
    expect(res.alternatives?.excluded).toEqual(
      expect.arrayContaining([expect.objectContaining({ sessionId: 's-sat-power', reason: 'CURRENT_SESSION' })]),
    );
  });

  it('routes the room move to the existing organiser approval rather than executing it', async () => {
    const res = await handleMessage(h.ctx, {
      eventId: h.eventId,
      userId: h.users.attendeeAda,
      text: 'There are too many people in Room 3.',
    });
    expect(res.approval).toMatchObject({ id: 'apr-seed-move-s-sat-power', status: 'PENDING', level: 'LEVEL_3' });
    const session = await h.store.getSession('s-sat-power');
    expect(session?.roomId).toBe('r-3');
  });

  it('shows staff a ranked assignment with the AV technician in the room zone first', async () => {
    const detail = await getIncidentDetail(h.ctx, h.eventId, h.users.opsKiri, 'inc-seed-av-r3');
    expect(detail.viewerCanOperate).toBe(true);
    expect(detail.recommendations[0]?.userId).toBe(h.users.opsKiri);
    expect(detail.recommendations.some((r) => r.userId === h.users.volunteerJamal)).toBe(false);
  });

  it('hides staff rankings from the attendee who reported', async () => {
    const detail = await getIncidentDetail(h.ctx, h.eventId, h.users.attendeeFatima, 'inc-seed-av-r3');
    expect(detail.viewerCanOperate).toBe(false);
    expect(detail.recommendations).toEqual([]);
    expect(detail.allowedNextStatuses).toEqual([]);
  });
});

describe('claiming and the incident lifecycle', () => {
  it('lets exactly one of two simultaneous claims succeed', async () => {
    const results = await Promise.allSettled([
      claimIncident(h.ctx, h.eventId, h.users.opsKiri, 'inc-seed-av-r3', 1),
      claimIncident(h.ctx, h.eventId, h.users.opsLena, 'inc-seed-av-r3', 1),
    ]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.reason).toMatchObject({ code: 'ALREADY_CLAIMED' });

    const stored = await h.store.getIncident('inc-seed-av-r3');
    expect(stored?.status).toBe('ASSIGNED');
    expect([h.users.opsKiri, h.users.opsLena]).toContain(stored?.assigneeUserId);
  });

  it('refuses a claim from staff without the required skill', async () => {
    await expectDomainError(claimIncident(h.ctx, h.eventId, h.users.opsMarco, 'inc-seed-av-r3', 1), 'INELIGIBLE');
  });

  it('refuses a claim with a stale version', async () => {
    await expectDomainError(claimIncident(h.ctx, h.eventId, h.users.opsKiri, 'inc-seed-av-r3', 99), 'VERSION_CONFLICT');
  });

  it('runs claim → acknowledge → in progress → resolve → confirm → auto-close, notifying the reporter', async () => {
    const id = 'inc-seed-av-r3';
    await claimIncident(h.ctx, h.eventId, h.users.opsKiri, id, await h.versionOf(id));
    await transitionIncident(h.ctx, { eventId: h.eventId, actorUserId: h.users.opsKiri, incidentId: id, to: 'ACKNOWLEDGED', expectedVersion: await h.versionOf(id) });
    await transitionIncident(h.ctx, { eventId: h.eventId, actorUserId: h.users.opsKiri, incidentId: id, to: 'IN_PROGRESS', expectedVersion: await h.versionOf(id) });

    // Someone who is not the assignee cannot mark the work resolved.
    await expectDomainError(
      transitionIncident(h.ctx, { eventId: h.eventId, actorUserId: h.users.opsLena, incidentId: id, to: 'RESOLVED', expectedVersion: await h.versionOf(id), resolutionNote: 'Fixed it' }),
      'FORBIDDEN',
    );

    await transitionIncident(h.ctx, {
      eventId: h.eventId,
      actorUserId: h.users.opsKiri,
      incidentId: id,
      to: 'RESOLVED',
      expectedVersion: await h.versionOf(id),
      resolutionNote: 'Replaced the lapel microphone and retested Room 3.',
    });

    // The reporter confirms; the system closes the incident as a second, recorded step.
    const closed = await transitionIncident(h.ctx, {
      eventId: h.eventId,
      actorUserId: h.users.attendeeFatima,
      incidentId: id,
      to: 'CONFIRMED',
      expectedVersion: await h.versionOf(id),
    });
    expect(closed.status).toBe('CLOSED');
    expect(closed.confirmedAt).not.toBeNull();

    const timeline = await h.store.listTimeline(id);
    const toStatuses = timeline.filter((t) => t.type === 'STATUS_CHANGED').map((t) => t.toStatus);
    expect(toStatuses).toEqual(expect.arrayContaining(['ACKNOWLEDGED', 'IN_PROGRESS', 'RESOLVED', 'CONFIRMED', 'CLOSED']));

    const notes = await h.store.listNotifications(h.users.attendeeFatima);
    expect(notes.map((n) => n.kind)).toContain('RESOLUTION_CONFIRMATION_REQUEST');
  });

  it('requires a description before an incident can be marked resolved', async () => {
    const id = 'inc-seed-av-r3';
    await claimIncident(h.ctx, h.eventId, h.users.opsKiri, id, 1);
    await transitionIncident(h.ctx, { eventId: h.eventId, actorUserId: h.users.opsKiri, incidentId: id, to: 'ACKNOWLEDGED', expectedVersion: 2 });
    await transitionIncident(h.ctx, { eventId: h.eventId, actorUserId: h.users.opsKiri, incidentId: id, to: 'IN_PROGRESS', expectedVersion: 3 });
    await expectDomainError(
      transitionIncident(h.ctx, { eventId: h.eventId, actorUserId: h.users.opsKiri, incidentId: id, to: 'RESOLVED', expectedVersion: 4, resolutionNote: '' }),
      'VALIDATION_FAILED',
    );
  });

  it('lets the reporter reopen closed work, which then re-enters triage', async () => {
    // The seeded FACILITIES incident is already CLOSED.
    const reopened = await transitionIncident(h.ctx, {
      eventId: h.eventId,
      actorUserId: h.users.attendeeChloe,
      incidentId: 'inc-seed-fac-r2',
      to: 'REOPENED',
      expectedVersion: await h.versionOf('inc-seed-fac-r2'),
    });
    expect(reopened.status).toBe('REOPENED');

    const triaged = await transitionIncident(h.ctx, {
      eventId: h.eventId,
      actorUserId: h.users.opsLena,
      incidentId: 'inc-seed-fac-r2',
      to: 'TRIAGED',
      expectedVersion: reopened.version,
    });
    expect(triaged.status).toBe('TRIAGED');
  });

  it('does not let an attendee who is not the reporter move an incident', async () => {
    await expectDomainError(
      transitionIncident(h.ctx, { eventId: h.eventId, actorUserId: h.users.attendeeBen, incidentId: 'inc-seed-av-r3', to: 'CANCELLED', expectedVersion: 1 }),
      'FORBIDDEN',
    );
  });
});

describe('visibility and cross-event isolation', () => {
  it('shows an attendee only incidents they reported', async () => {
    await expectDomainError(getIncidentDetail(h.ctx, h.eventId, h.users.attendeeBen, 'inc-seed-av-r3'), 'NOT_FOUND');
  });

  it('never reveals an incident that belongs to a different event', async () => {
    h.store.seed({
      events: [{ id: 'evt-other', name: 'Other event', timezone: 'UTC', isDemo: true }],
      users: [],
      memberships: [],
      rooms: [],
      sessions: [],
      incidents: [
        {
          id: 'inc-other',
          eventId: 'evt-other',
          category: 'AV',
          status: 'TRIAGED',
          urgency: 'MEDIUM',
          title: 'Other',
          roomId: null,
          sessionId: null,
          equipment: [],
          createdByUserId: h.users.attendeeAda,
          assigneeUserId: null,
          version: 1,
          createdAt: DEMO_T0,
          updatedAt: DEMO_T0,
          acknowledgedAt: null,
          resolvedAt: null,
          confirmedAt: null,
          resolutionNote: null,
        },
      ],
    });
    // Ada is a member of the demo event, not of evt-other.
    await expectDomainError(getIncidentDetail(h.ctx, h.eventId, h.users.attendeeAda, 'inc-other'), 'NOT_FOUND');
  });

  it('refuses people who are not members of the event', async () => {
    await expectDomainError(
      handleMessage(h.ctx, { eventId: h.eventId, userId: 'u-stranger', text: 'Mic broken in Room 3' }),
      'FORBIDDEN',
    );
  });
});

describe('approvals: approval and execution are separate facts', () => {
  it('never lets an attendee raise an approval, and routes the request to organisers instead', async () => {
    const before = (await h.store.listApprovals(h.eventId)).length;
    const res = await handleMessage(h.ctx, {
      eventId: h.eventId,
      userId: h.users.attendeeBen,
      text: 'Please move the Satellite Power Systems session to the Main Hall.',
    });
    expect(res.approval).toBeNull();
    expect(res.incidents).toHaveLength(1);
    expect((await h.store.listApprovals(h.eventId)).length).toBe(before);
  });

  it('records a failed execution after an approval, without pretending the move happened', async () => {
    // Robotics in Practice holds Main Hall 13:00–14:00, so moving the satellite session there must fail.
    const approval = await requestApproval(h.ctx, {
      eventId: h.eventId,
      requestedByUserId: h.users.opsLena,
      actionType: 'MOVE_SESSION_ROOM',
      payload: { sessionId: 's-sat-power', toRoomId: 'r-main' },
      justification: 'Test clash',
      linkedIncidentId: null,
    });
    const decided = await decideApproval(h.ctx, {
      eventId: h.eventId,
      actorUserId: h.users.organiserNadia,
      approvalId: approval.id,
      decision: 'APPROVE',
      reason: 'Looks fine',
      expectedVersion: 0,
    });
    expect(decided.status).toBe('APPROVED');
    expect(decided.executionStatus).toBe('FAILED');
    expect(decided.executionResult).toContain('already booked');
    expect((await h.store.getSession('s-sat-power'))?.roomId).toBe('r-3');
  });

  it('executes the seeded room move once, then refuses to execute it again', async () => {
    const approved = await decideApproval(h.ctx, {
      eventId: h.eventId,
      actorUserId: h.users.organiserNadia,
      approvalId: 'apr-seed-move-s-sat-power',
      decision: 'APPROVE',
      reason: 'Approved: Room 4 is free at 13:00.',
      expectedVersion: 0,
    });
    expect(approved).toMatchObject({ status: 'APPROVED', executionStatus: 'SUCCEEDED' });
    expect((await h.store.getSession('s-sat-power'))?.roomId).toBe('r-4');

    await expectDomainError(
      executeApproval(h.ctx, h.eventId, h.users.organiserNadia, 'apr-seed-move-s-sat-power'),
      'EXECUTION_NOT_ALLOWED',
    );
  });

  it('blocks an organiser from approving their own request', async () => {
    const own = await requestApproval(h.ctx, {
      eventId: h.eventId,
      requestedByUserId: h.users.organiserNadia,
      actionType: 'PUBLISH_ANNOUNCEMENT',
      payload: { title: 'Doors', body: 'Doors open at 9.' },
      justification: 'Self request',
      linkedIncidentId: null,
    });
    await expectDomainError(
      decideApproval(h.ctx, { eventId: h.eventId, actorUserId: h.users.organiserNadia, approvalId: own.id, decision: 'APPROVE', reason: 'ok', expectedVersion: 0 }),
      'FORBIDDEN',
    );
  });

  it('requires a reason to reject, and a decided request cannot be decided again', async () => {
    const request = await requestApproval(h.ctx, {
      eventId: h.eventId,
      requestedByUserId: h.users.opsLena,
      actionType: 'PUBLISH_ANNOUNCEMENT',
      payload: { title: 'Lunch', body: 'Lunch moves to 13:30.' },
      justification: 'Schedule change',
      linkedIncidentId: null,
    });
    await expectDomainError(
      decideApproval(h.ctx, { eventId: h.eventId, actorUserId: h.users.organiserNadia, approvalId: request.id, decision: 'REJECT', reason: '', expectedVersion: 0 }),
      'VALIDATION_FAILED',
    );
    const rejected = await decideApproval(h.ctx, {
      eventId: h.eventId,
      actorUserId: h.users.organiserNadia,
      approvalId: request.id,
      decision: 'REJECT',
      reason: 'Conflicts with the agenda change already published.',
      expectedVersion: 0,
    });
    expect(rejected.status).toBe('REJECTED');
    await expectDomainError(
      decideApproval(h.ctx, { eventId: h.eventId, actorUserId: h.users.organiserNadia, approvalId: request.id, decision: 'APPROVE', reason: 'changed mind', expectedVersion: 1 }),
      'APPROVAL_NOT_DECIDABLE',
    );
  });

  it('expires an approval that is decided after its window', async () => {
    const request = await requestApproval(h.ctx, {
      eventId: h.eventId,
      requestedByUserId: h.users.opsLena,
      actionType: 'PUBLISH_ANNOUNCEMENT',
      payload: { title: 'Late', body: 'Late decision.' },
      justification: 'Time test',
      linkedIncidentId: null,
    });
    h.setNow(request.expiresAt + 1);
    await expectDomainError(
      decideApproval(h.ctx, { eventId: h.eventId, actorUserId: h.users.organiserNadia, approvalId: request.id, decision: 'APPROVE', reason: 'late', expectedVersion: 0 }),
      'APPROVAL_NOT_DECIDABLE',
    );
    expect((await h.store.getApproval(request.id))?.status).toBe('EXPIRED');
  });

  it('rejects a decision that was made against an outdated approval version', async () => {
    await expectDomainError(
      decideApproval(h.ctx, { eventId: h.eventId, actorUserId: h.users.organiserNadia, approvalId: 'apr-seed-move-s-sat-power', decision: 'APPROVE', reason: 'ok', expectedVersion: 7 }),
      'VERSION_CONFLICT',
    );
  });
});

describe('signal intelligence', () => {
  it('suggests a pattern only from stored reports, and keeps the human review', async () => {
    await handleMessage(h.ctx, { eventId: h.eventId, userId: h.users.attendeeAda, text: 'The microphone in Room 3 is not working.' });
    await handleMessage(h.ctx, { eventId: h.eventId, userId: h.users.attendeeHana, text: 'Mic cutting out in Room 3.' });
    await handleMessage(h.ctx, { eventId: h.eventId, userId: h.users.attendeeBen, text: 'No sound from the speakers in Room 3.' });

    const patterns = await refreshSignals(h.ctx, h.eventId, h.users.organiserNadia);
    const avRoom3 = patterns.find((p) => p.scope.roomId === 'r-3' && p.scope.category === 'AV');
    expect(avRoom3).toBeDefined();
    expect(avRoom3?.distinctReporters).toBe(3);
    expect(avRoom3?.reviewStatus).toBe('PENDING_REVIEW');

    const accepted = await reviewPattern(h.ctx, h.eventId, h.users.organiserNadia, avRoom3?.id ?? '', 'ACCEPTED');
    expect(accepted.reviewStatus).toBe('ACCEPTED');

    // A later recomputation must not overwrite a human decision.
    await refreshSignals(h.ctx, h.eventId, h.users.organiserNadia);
    expect((await h.store.getSignalPattern(avRoom3?.id ?? ''))?.reviewStatus).toBe('ACCEPTED');
  });

  it('lets only organisers review, and hides signal data from attendees', async () => {
    await expectDomainError(refreshSignals(h.ctx, h.eventId, h.users.attendeeAda), 'FORBIDDEN');
    await refreshSignals(h.ctx, h.eventId, h.users.opsLena);
    await expectDomainError(reviewPattern(h.ctx, h.eventId, h.users.opsLena, 'anything', 'ACCEPTED'), 'FORBIDDEN');
  });
});

describe('people discovery', () => {
  it('matches only discoverable people and returns no contact details', async () => {
    const matches = await discoverPeople(h.ctx, h.eventId, h.users.attendeeAda, 'cybersecurity');
    const ids = matches.map((m) => m.userId);
    expect(ids).toContain(h.users.attendeeBen);
    expect(ids).not.toContain(h.users.attendeeEli);
    for (const match of matches) {
      expect(Object.keys(match).sort()).toEqual(
        ['declaredInterests', 'displayName', 'matchedInterests', 'reason', 'role', 'userId'].sort(),
      );
      expect(match.matchedInterests.length).toBeGreaterThan(0);
    }
  });
});

describe('status follow-up', () => {
  it('answers from persisted state rather than from the model', async () => {
    const res = await handleMessage(h.ctx, {
      eventId: h.eventId,
      userId: h.users.attendeeFatima,
      text: 'I reported this problem twenty minutes ago. Is anyone handling it?',
    });
    expect(res.interpretation.intent).toBe('STATUS_CHECK');
    expect(res.statusReport).toMatchObject({ incidentId: 'inc-seed-av-r3', status: 'TRIAGED', assigneeName: null });
    expect(res.reply).toContain('nobody has claimed it yet');
  });
});

describe('input validation and degraded AI', () => {
  it('rejects empty messages', async () => {
    await expectDomainError(handleMessage(h.ctx, { eventId: h.eventId, userId: h.users.attendeeAda, text: '   ' }), 'VALIDATION_FAILED');
  });

  it('still records the incident when the model returns invalid output', async () => {
    const broken: IntentProvider = { name: 'broken', classify: () => Promise.resolve({ intent: 'NUKE' }) };
    const local = await createHarness({ provider: broken });
    const res = await handleMessage(local.ctx, {
      eventId: local.eventId,
      userId: local.users.attendeeBen,
      text: 'The projector in Main Hall has stopped working.',
    });
    expect(res.interpretation.source).toBe('DETERMINISTIC_FALLBACK');
    expect(res.interpretation.fallbackReason).toBe('INVALID_STRUCTURED_OUTPUT');
    expect(res.incidents[0]?.category).toBe('AV');
  });

  it('asks which room instead of guessing when none is named', async () => {
    const res = await handleMessage(h.ctx, { eventId: h.eventId, userId: h.users.attendeeBen, text: 'The projector is broken.' });
    expect(res.incidents[0]).toMatchObject({ status: 'NEEDS_INFORMATION' });
    expect(res.clarifyingQuestion).toContain('Which room');
  });

  it('records every message in the conversation history', async () => {
    await handleMessage(h.ctx, { eventId: h.eventId, userId: h.users.attendeeBen, text: 'Toilets are dirty.' });
    const messages = await (h.store).listMessages(h.eventId);
    expect(messages.some((m) => m.senderUserId === h.users.attendeeBen)).toBe(true);
  });
});

describe('the seeded event is labelled as demonstration data', () => {
  it('marks the event and every occupancy figure as demo', async () => {
    const event = await h.store.getEvent(h.eventId);
    expect(event?.isDemo).toBe(true);
    const rooms = await h.store.listRooms(h.eventId);
    for (const room of rooms.filter((r) => r.occupancy !== null)) {
      expect(room.occupancySource).toBe('DEMO_SEED');
    }
  });
});
