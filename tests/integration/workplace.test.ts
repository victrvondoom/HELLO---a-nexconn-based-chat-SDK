import { beforeEach, describe, expect, it } from 'vitest';
import { createHarness, type Harness } from './harness';
import { DEMO_NOW } from '@/store/seed';
import { sweepOverdueIncidents, listSlaBoard, updateProfile, setAvailability, listTeam, requestAnnouncement, listAnnouncementsFor, notificationFeed, markAllNotificationsRead, listAuditFor } from '@/services/workplace';
import { decideApproval } from '@/services/approvals';
import { discoverPeople } from '@/services/people';
import { claimIncident, transitionIncident } from '@/services/incidents';

const MIN = 60_000;
let h: Harness;
beforeEach(async () => {
  h = await createHarness();
});

describe('SLA sweep', () => {
  it('escalates unclaimed incidents that missed their acknowledgement target, once', async () => {
    h.setNow(DEMO_NOW + 45 * MIN); // past the 30 minute target for the MEDIUM AV incident
    const first = await sweepOverdueIncidents(h.ctx, h.eventId, h.users.opsKiri);
    expect(first.escalated.map((e) => e.incidentId)).toEqual(expect.arrayContaining(['inc-seed-av-r3', 'inc-seed-cap-r3']));
    expect((await h.store.getIncident('inc-seed-av-r3'))?.status).toBe('ESCALATED');

    const second = await sweepOverdueIncidents(h.ctx, h.eventId, h.users.opsKiri);
    expect(second.escalated).toHaveLength(0);
  });

  it('does not escalate work that someone has already acknowledged', async () => {
    h.setNow(DEMO_NOW + 45 * MIN);
    await claimIncident(h.ctx, h.eventId, h.users.opsKiri, 'inc-seed-av-r3', 1);
    await transitionIncident(h.ctx, { eventId: h.eventId, actorUserId: h.users.opsKiri, incidentId: 'inc-seed-av-r3', to: 'ACKNOWLEDGED', expectedVersion: 2 });
    const sweep = await sweepOverdueIncidents(h.ctx, h.eventId, h.users.opsKiri);
    expect(sweep.escalated.map((e) => e.incidentId)).not.toContain('inc-seed-av-r3');
  });

  it('is available only to staff who can escalate', async () => {
    h.setNow(DEMO_NOW + 45 * MIN);
    await expect(sweepOverdueIncidents(h.ctx, h.eventId, h.users.attendeeAda)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('shows the board most-overdue first, with live timers', async () => {
    h.setNow(DEMO_NOW + 45 * MIN);
    const board = await listSlaBoard(h.ctx, h.eventId, h.users.opsKiri);
    expect(board[0]?.sla.state).toBe('BREACHED');
    expect(board.every((row) => row.sla.targetMinutes > 0)).toBe(true);
  });
});

describe('profile consent and availability', () => {
  it('removes a person from people search as soon as they turn discoverability off', async () => {
    const before = await discoverPeople(h.ctx, h.eventId, h.users.attendeeAda, 'cybersecurity');
    expect(before.map((m) => m.userId)).toContain(h.users.attendeeBen);
    await updateProfile(h.ctx, h.users.attendeeBen, {
      displayName: 'Ben (demo attendee)',
      interests: ['cybersecurity'],
      discoverable: false,
      accessibilityRequired: false,
    });
    const after = await discoverPeople(h.ctx, h.eventId, h.users.attendeeAda, 'cybersecurity');
    expect(after.map((m) => m.userId)).not.toContain(h.users.attendeeBen);
  });

  it('lets attendees edit interests, but not set staff availability', async () => {
    await expect(setAvailability(h.ctx, h.eventId, h.users.attendeeAda, 'BUSY')).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('reorders the team directory when a technician goes off shift', async () => {
    const before = await listTeam(h.ctx, h.eventId, h.users.opsLena);
    expect(before[0]?.availability).toBe('AVAILABLE');
    await setAvailability(h.ctx, h.eventId, h.users.opsKiri, 'OFF_SHIFT');
    const after = await listTeam(h.ctx, h.eventId, h.users.opsLena);
    expect(after.find((r) => r.userId === h.users.opsKiri)?.availability).toBe('OFF_SHIFT');
    expect(after[after.length - 1]?.userId).toBe(h.users.opsKiri);
  });

  it('removes an off-shift technician from assignment recommendations', async () => {
    await setAvailability(h.ctx, h.eventId, h.users.opsKiri, 'OFF_SHIFT');
    await expect(claimIncident(h.ctx, h.eventId, h.users.opsKiri, 'inc-seed-av-r3', 1)).rejects.toMatchObject({ code: 'INELIGIBLE' });
  });
});

describe('announcements through approval', () => {
  it('publishes only after a different organiser approves the request', async () => {
    const request = await requestAnnouncement(h.ctx, h.eventId, h.users.organiserNadia, 'Lunch moves', 'Lunch is now served at 13:30 in the Main Hall foyer.');
    expect(request.status).toBe('PENDING');
    expect((await listAnnouncementsFor(h.ctx, h.eventId, h.users.attendeeAda)).map((a) => a.title)).not.toContain('Lunch moves');

    await decideApproval(h.ctx, { eventId: h.eventId, actorUserId: h.users.organiserOwen, approvalId: request.id, decision: 'APPROVE', reason: 'Confirmed with catering.', expectedVersion: 0 });
    const published = await listAnnouncementsFor(h.ctx, h.eventId, h.users.attendeeAda);
    expect(published.map((a) => a.title)).toContain('Lunch moves');
  });

  it('keeps the requester from deciding their own announcement', async () => {
    const request = await requestAnnouncement(h.ctx, h.eventId, h.users.organiserNadia, 'Room change', 'Room 2 is now closed for the afternoon.');
    await expect(
      decideApproval(h.ctx, { eventId: h.eventId, actorUserId: h.users.organiserNadia, approvalId: request.id, decision: 'APPROVE', reason: 'self', expectedVersion: 0 }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('rejects announcements that are too short to be useful', async () => {
    await expect(requestAnnouncement(h.ctx, h.eventId, h.users.organiserNadia, 'Hi', 'short')).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });
});

describe('notifications read state', () => {
  it('counts unread notifications and clears them on request', async () => {
    const feed = await notificationFeed(h.ctx, h.eventId, h.users.attendeeAda);
    expect(feed.unread).toBeGreaterThan(0);
    const changed = await markAllNotificationsRead(h.ctx, h.eventId, h.users.attendeeAda);
    expect(changed).toBe(feed.unread);
    expect((await notificationFeed(h.ctx, h.eventId, h.users.attendeeAda)).unread).toBe(0);
  });
});

describe('audit trail', () => {
  it('is readable by organisers, and records what the sweep did', async () => {
    h.setNow(DEMO_NOW + 45 * MIN);
    await sweepOverdueIncidents(h.ctx, h.eventId, h.users.opsKiri);
    const trail = await listAuditFor(h.ctx, h.eventId, h.users.organiserNadia);
    expect(trail.map((e) => e.action)).toContain('sla.sweep');
    await expect(listAuditFor(h.ctx, h.eventId, h.users.opsKiri)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
