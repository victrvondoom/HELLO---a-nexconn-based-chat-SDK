import { describe, expect, it, vi } from 'vitest';
import { createHarness } from './harness';
import { DomainError } from '@/domain/errors';
import { describeWrite } from '@/lib/live/store';
import { claimIncident, transitionIncident } from '@/services/incidents';
import { dismissLiveReport, liveFeed, placeSafetyHold, promoteLiveReport, releaseSafetyHold, submitLiveReport } from '@/services/live';
import { snapshotFor } from '@/services/context-graph';
import { CLUSTER_WINDOW_MS, DUPLICATE_WINDOW_MS, LIVE_TTL_MINUTES } from '@/domain/live/rules';
import type { LiveReport } from '@/domain/product';

const MIN = 60 * 1000;

async function expectDomainError(promise: Promise<unknown>, code: string): Promise<void> {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(DomainError);
  expect((error as DomainError).code).toBe(code);
}

async function harnessWithReport(text = 'Water is leaking from the ceiling', category: LiveReport['category'] = 'TECHNICAL', spaceId = 'sp-main') {
  const h = await createHarness();
  const reporter = h.users.attendeeBen;
  const { report } = await submitLiveReport(h.ctx, { eventId: h.eventId, userId: reporter, spaceId, category, text });
  return { h, report, reporter };
}

describe('LiveScene: reporting a place', () => {
  it('records the zone from the venue and the expiry from the category', async () => {
    const h = await createHarness();
    const { report } = await submitLiveReport(h.ctx, {
      eventId: h.eventId,
      userId: h.users.attendeeAda,
      spaceId: 'sp-r3',
      category: 'CROWD',
      text: 'The doorway to Room 3 is blocked',
    });
    expect(report.zone).toBe('Workshop');
    expect(report.status).toBe('OPEN');
    expect(report.expiresAt - report.createdAt).toBe(LIVE_TTL_MINUTES.CROWD * MIN);
  });

  it('refuses a place that is not on the venue map', async () => {
    const h = await createHarness();
    await expectDomainError(
      submitLiveReport(h.ctx, { eventId: h.eventId, userId: h.users.attendeeAda, spaceId: 'sp-nowhere', category: 'CROWD', text: 'Too crowded here' }),
      'NOT_FOUND',
    );
  });

  it('refuses the same text for the same place within the duplicate window, and allows it afterwards', async () => {
    const h = await createHarness();
    const input = { eventId: h.eventId, userId: h.users.attendeeAda, spaceId: 'sp-main', category: 'CROWD' as const, text: 'Queue reaches the door' };
    await submitLiveReport(h.ctx, input);
    await expectDomainError(submitLiveReport(h.ctx, input), 'DUPLICATE');
    h.setNow(h.now() + DUPLICATE_WINDOW_MS + MIN);
    await expect(submitLiveReport(h.ctx, input)).resolves.toBeDefined();
  });

  it('flags emergency words, sends the venue fallback guidance, and queues the report for review', async () => {
    const h = await createHarness();
    const { report, guidance } = await submitLiveReport(h.ctx, {
      eventId: h.eventId,
      userId: h.users.attendeeBen,
      spaceId: 'sp-main',
      category: 'SAFETY',
      text: 'Someone collapsed and is not breathing',
    });
    expect(report.safetySignal).toBe('MEDICAL');
    expect(guidance).toMatch(/emergency number/i);
    const staffView = await liveFeed(h.ctx, h.eventId, h.users.opsLena);
    expect(staffView.queue.map((item) => item.id)).toContain(report.id);
  });
});

describe('LiveScene: what each person sees', () => {
  it('hides reporter identity and text from attendees, and shows them to staff', async () => {
    const { h, report, reporter } = await harnessWithReport();
    const attendee = await liveFeed(h.ctx, h.eventId, h.users.attendeeAda);
    const seenByOther = attendee.reports.find((item) => item.id === report.id);
    expect(seenByOther?.text).toBeNull();
    expect(seenByOther?.reporterName).toBeNull();
    expect(seenByOther?.mine).toBe(false);

    const own = await liveFeed(h.ctx, h.eventId, reporter);
    expect(own.reports.find((item) => item.id === report.id)?.text).toBe('Water is leaking from the ceiling');

    const staff = await liveFeed(h.ctx, h.eventId, h.users.opsLena);
    const seenByStaff = staff.reports.find((item) => item.id === report.id);
    expect(seenByStaff?.text).toBe('Water is leaking from the ceiling');
    expect(seenByStaff?.reporterName).toMatch(/Ben/);
  });

  it('drops a report from the live view when its time to live ends, and keeps it in the staff record', async () => {
    const { h, report } = await harnessWithReport('Queue reaches the door', 'CROWD', 'sp-main');
    h.setNow(report.expiresAt + MIN);
    const attendee = await liveFeed(h.ctx, h.eventId, h.users.attendeeAda);
    expect(attendee.reports.some((item) => item.id === report.id)).toBe(false);
    expect(await h.store.docGet('liveReports', report.id)).not.toBeNull();
  });

  it('groups reports by place and time into one cluster, and keeps a distant report apart', async () => {
    const h = await createHarness();
    const base = h.now();
    const first = await submitLiveReport(h.ctx, { eventId: h.eventId, userId: h.users.attendeeAda, spaceId: 'sp-atrium', category: 'CROWD', text: 'Packed at the atrium doors' });
    h.setNow(base + 2 * MIN);
    const second = await submitLiveReport(h.ctx, { eventId: h.eventId, userId: h.users.attendeeBen, spaceId: 'sp-atrium', category: 'CROWD', text: 'Still packed near the doors' });
    // Crowd reports live for 30 minutes. The third is 18 minutes after the second: outside the 15-minute window,
    // yet still live when the feed is read, so the test checks the clustering rather than expiry.
    h.setNow(base + CLUSTER_WINDOW_MS + 5 * MIN);
    const third = await submitLiveReport(h.ctx, { eventId: h.eventId, userId: h.users.attendeeChloe, spaceId: 'sp-atrium', category: 'CROWD', text: 'Much later, same atrium' });
    h.setNow(base + CLUSTER_WINDOW_MS + 6 * MIN);
    const feed = await liveFeed(h.ctx, h.eventId, h.users.organiserNadia);
    const sizeOf = (id: string) => feed.reports.find((item) => item.id === id)?.clusterSize;
    expect(sizeOf(first.report.id)).toBe(2);
    expect(sizeOf(second.report.id)).toBe(2);
    expect(sizeOf(third.report.id)).toBe(1);
  });
});

describe('LiveShield: promotion to an incident', () => {
  it('opens exactly one incident for a report, however many staff press the button', async () => {
    const { h, report } = await harnessWithReport();
    const before = (await h.store.listIncidents(h.eventId)).length;
    const results = await Promise.allSettled([
      promoteLiveReport(h.ctx, { eventId: h.eventId, actorUserId: h.users.opsLena, reportId: report.id, category: 'TECHNICAL' }),
      promoteLiveReport(h.ctx, { eventId: h.eventId, actorUserId: h.users.opsKiri, reportId: report.id, category: 'TECHNICAL' }),
    ]);
    const fulfilled = results.filter((r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof promoteLiveReport>>> => r.status === 'fulfilled');
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(fulfilled.length).toBeGreaterThanOrEqual(1);
    for (const outcome of rejected) {
      expect(outcome.reason).toBeInstanceOf(DomainError);
    }
    const incidentIds = new Set(fulfilled.map((r) => r.value.incident.id));
    expect(incidentIds.size).toBe(1);
    expect((await h.store.listIncidents(h.eventId)).length).toBe(before + 1);
    const stored = await h.store.docGet('liveReports', report.id);
    expect(stored?.status).toBe('PROMOTED');
    expect(stored?.incidentId).toBe([...incidentIds][0]);
  });

  it('returns the same incident on a second promotion, without creating another', async () => {
    const { h, report } = await harnessWithReport();
    const first = await promoteLiveReport(h.ctx, { eventId: h.eventId, actorUserId: h.users.opsLena, reportId: report.id, category: 'TECHNICAL' });
    const again = await promoteLiveReport(h.ctx, { eventId: h.eventId, actorUserId: h.users.opsLena, reportId: report.id, category: 'TECHNICAL' });
    expect(again.alreadyPromoted).toBe(true);
    expect(again.incident.id).toBe(first.incident.id);
  });

  it('refuses to promote a kind of report that is not an incident, and refuses attendees', async () => {
    const h = await createHarness();
    const { report } = await submitLiveReport(h.ctx, { eventId: h.eventId, userId: h.users.attendeeBen, spaceId: 'sp-main', category: 'SOCIAL', text: 'Music in the hall' });
    await expectDomainError(promoteLiveReport(h.ctx, { eventId: h.eventId, actorUserId: h.users.opsLena, reportId: report.id, category: 'SOCIAL' }), 'VALIDATION_FAILED');
    await expectDomainError(promoteLiveReport(h.ctx, { eventId: h.eventId, actorUserId: h.users.attendeeAda, reportId: report.id, category: 'TECHNICAL' }), 'FORBIDDEN');
  });

  it('reports a verified resolution only after the reporter confirms, read from the incident', async () => {
    const { h, report, reporter } = await harnessWithReport('Projector sparks when switched on', 'TECHNICAL', 'sp-main');
    const { incident } = await promoteLiveReport(h.ctx, { eventId: h.eventId, actorUserId: h.users.opsLena, reportId: report.id, category: 'TECHNICAL' });
    const version = async () => (await h.store.getIncident(incident.id))?.version ?? 0;

    await claimIncident(h.ctx, h.eventId, h.users.opsLena, incident.id, await version());
    await transitionIncident(h.ctx, { eventId: h.eventId, actorUserId: h.users.opsLena, incidentId: incident.id, to: 'ACKNOWLEDGED', expectedVersion: await version() });
    await transitionIncident(h.ctx, { eventId: h.eventId, actorUserId: h.users.opsLena, incidentId: incident.id, to: 'IN_PROGRESS', expectedVersion: await version() });
    await transitionIncident(h.ctx, {
      eventId: h.eventId,
      actorUserId: h.users.opsLena,
      incidentId: incident.id,
      to: 'RESOLVED',
      expectedVersion: await version(),
      resolutionNote: 'Cable replaced and tested.',
    });
    const pending = await liveFeed(h.ctx, h.eventId, reporter);
    expect(pending.reports.find((item) => item.id === report.id)?.resolution).toBe('RESOLUTION_PENDING_CONFIRMATION');

    await transitionIncident(h.ctx, { eventId: h.eventId, actorUserId: reporter, incidentId: incident.id, to: 'CONFIRMED', expectedVersion: await version() });
    const verified = await liveFeed(h.ctx, h.eventId, reporter);
    expect(verified.reports.find((item) => item.id === report.id)?.resolution).toBe('VERIFIED_RESOLVED');
  });

  it('dismisses an open report only with a reason, and only once', async () => {
    const { h, report } = await harnessWithReport('Two bins overflowing', 'TECHNICAL', 'sp-main');
    await expectDomainError(dismissLiveReport(h.ctx, { eventId: h.eventId, actorUserId: h.users.opsLena, reportId: report.id, reason: 'no' }), 'VALIDATION_FAILED');
    await dismissLiveReport(h.ctx, { eventId: h.eventId, actorUserId: h.users.opsLena, reportId: report.id, reason: 'Duplicate of a known issue' });
    await expectDomainError(dismissLiveReport(h.ctx, { eventId: h.eventId, actorUserId: h.users.opsLena, reportId: report.id, reason: 'Again' }), 'ALREADY_HANDLED');
  });
});

describe('LiveShield: safety holds', () => {
  const minutes = 30;

  it('suspends the public view of a zone for attendees, but not for staff or the reporter', async () => {
    const h = await createHarness();
    const other = await submitLiveReport(h.ctx, { eventId: h.eventId, userId: h.users.attendeeBen, spaceId: 'sp-r3', category: 'SAFETY', text: 'A trip hazard by the stage' });
    const mine = await submitLiveReport(h.ctx, { eventId: h.eventId, userId: h.users.attendeeAda, spaceId: 'sp-r3', category: 'ACCESSIBILITY', text: 'Ramp is blocked by boxes' });
    await placeSafetyHold(h.ctx, { eventId: h.eventId, actorUserId: h.users.opsLena, scope: { kind: 'ZONE', zone: 'Workshop' }, reason: 'Investigating two reports', durationMinutes: minutes });

    const attendee = await liveFeed(h.ctx, h.eventId, h.users.attendeeChloe);
    expect(attendee.reports.some((item) => item.id === other.report.id)).toBe(false);
    expect(attendee.reports.some((item) => item.id === mine.report.id)).toBe(false);

    const reporter = await liveFeed(h.ctx, h.eventId, h.users.attendeeAda);
    expect(reporter.reports.find((item) => item.id === mine.report.id)?.underReview).toBe(true);

    const staff = await liveFeed(h.ctx, h.eventId, h.users.opsKiri);
    expect(staff.reports.some((item) => item.id === other.report.id)).toBe(true);
    expect(staff.holds).toHaveLength(1);
  });

  it('lets only an organiser place a whole-event hold', async () => {
    const h = await createHarness();
    await expectDomainError(
      placeSafetyHold(h.ctx, { eventId: h.eventId, actorUserId: h.users.opsLena, scope: { kind: 'EVENT' }, reason: 'Whole event concern', durationMinutes: minutes }),
      'FORBIDDEN',
    );
    const { hold, created } = await placeSafetyHold(h.ctx, { eventId: h.eventId, actorUserId: h.users.organiserNadia, scope: { kind: 'EVENT' }, reason: 'Whole event concern', durationMinutes: minutes });
    expect(created).toBe(true);
    expect(hold.scope).toEqual({ kind: 'EVENT' });
  });

  it('returns the hold already in force instead of creating a second one for the same scope', async () => {
    const h = await createHarness();
    const first = await placeSafetyHold(h.ctx, { eventId: h.eventId, actorUserId: h.users.opsLena, scope: { kind: 'ZONE', zone: 'Main' }, reason: 'Crowd pressure at the hall', durationMinutes: minutes });
    const second = await placeSafetyHold(h.ctx, { eventId: h.eventId, actorUserId: h.users.opsKiri, scope: { kind: 'ZONE', zone: 'Main' }, reason: 'Crowd pressure at the hall', durationMinutes: minutes });
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.hold.id).toBe(first.hold.id);
  });

  it('will not let the person who placed a hold release it, and lets a different organiser do so', async () => {
    const h = await createHarness();
    const { hold } = await placeSafetyHold(h.ctx, { eventId: h.eventId, actorUserId: h.users.organiserNadia, scope: { kind: 'EVENT' }, reason: 'Whole event concern', durationMinutes: minutes });
    await expectDomainError(releaseSafetyHold(h.ctx, { eventId: h.eventId, actorUserId: h.users.organiserNadia, holdId: hold.id, reason: 'Looks fine now' }), 'FORBIDDEN');
    await expectDomainError(releaseSafetyHold(h.ctx, { eventId: h.eventId, actorUserId: h.users.opsLena, holdId: hold.id, reason: 'Looks fine now' }), 'FORBIDDEN');
    const released = await releaseSafetyHold(h.ctx, { eventId: h.eventId, actorUserId: h.users.organiserOwen, holdId: hold.id, reason: 'Checked with the venue team' });
    expect(released.status).toBe('RELEASED');
    await expectDomainError(releaseSafetyHold(h.ctx, { eventId: h.eventId, actorUserId: h.users.organiserOwen, holdId: hold.id, reason: 'Again' }), 'ALREADY_HANDLED');
  });

  it('keeps a hold in force after its decision time passes, and marks it overdue', async () => {
    const h = await createHarness();
    const { hold } = await placeSafetyHold(h.ctx, { eventId: h.eventId, actorUserId: h.users.opsLena, scope: { kind: 'ZONE', zone: 'Atrium' }, reason: 'Investigating a report', durationMinutes: 5 });
    await submitLiveReport(h.ctx, { eventId: h.eventId, userId: h.users.attendeeBen, spaceId: 'sp-atrium', category: 'ACCESSIBILITY', text: 'Lift queue is blocking the step-free route' });
    h.setNow(h.now() + 60 * MIN);
    const attendee = await liveFeed(h.ctx, h.eventId, h.users.attendeeAda);
    expect(attendee.reports).toHaveLength(0);
    const staff = await liveFeed(h.ctx, h.eventId, h.users.organiserNadia);
    expect(staff.holds.find((view) => view.id === hold.id)?.overdue).toBe(true);
  });

  it('refuses a zone that is not on the venue map', async () => {
    const h = await createHarness();
    await expectDomainError(
      placeSafetyHold(h.ctx, { eventId: h.eventId, actorUserId: h.users.opsLena, scope: { kind: 'ZONE', zone: 'Mars' }, reason: 'Unknown zone here', durationMinutes: minutes }),
      'NOT_FOUND',
    );
  });

  it('fails closed when the hold records cannot be read: attendees see only their own reports', async () => {
    const { h, report, reporter } = await harnessWithReport('Spill near the bar', 'TECHNICAL', 'sp-main');
    const original = h.store.docList.bind(h.store);
    vi.spyOn(h.store, 'docList').mockImplementation((collection: string, where?: unknown) => {
      if (collection === 'safetyHolds') return Promise.reject(new Error('store unavailable'));
      return original(collection as never, where as never);
    });
    const attendee = await liveFeed(h.ctx, h.eventId, h.users.attendeeAda);
    expect(attendee.state).toBe('HOLDS_UNAVAILABLE');
    expect(attendee.reports).toHaveLength(0);
    const own = await liveFeed(h.ctx, h.eventId, reporter);
    expect(own.reports.map((item) => item.id)).toEqual([report.id]);
    const staff = await liveFeed(h.ctx, h.eventId, h.users.opsLena);
    expect(staff.state).toBe('HOLDS_UNAVAILABLE');
    expect(staff.reports.map((item) => item.id)).toContain(report.id);
  });
});

describe('Context snapshot', () => {
  it('gives staff the facts, the missing decision and a recommendation, each with its capability', async () => {
    const h = await createHarness();
    const { report } = await submitLiveReport(h.ctx, { eventId: h.eventId, userId: h.users.attendeeBen, spaceId: 'sp-main', category: 'SAFETY', text: 'Smoke coming from the back exit' });
    const snapshot = await snapshotFor(h.ctx, { eventId: h.eventId, actorUserId: h.users.opsLena, scope: { kind: 'REPORT', reportId: report.id } });
    expect(snapshot.viewer).toBe('STAFF');
    expect(snapshot.facts.some((fact) => fact.kind === 'REPORTED' && fact.statement.includes('Smoke coming from the back exit'))).toBe(true);
    expect(snapshot.missing.some((text) => text.includes('no moderator decision'))).toBe(true);
    const review = snapshot.recommendations.find((item) => item.action === 'REVIEW_NOW');
    expect(review?.requiredCapability).toBe('live.review');
    expect(review?.basedOnFactIds.length).toBeGreaterThan(0);
  });

  it('gives an attendee the public view: no reporter name, no report text from others, no decision recommendations', async () => {
    const { h, report } = await harnessWithReport('Queue reaches the door', 'CROWD', 'sp-main');
    const snapshot = await snapshotFor(h.ctx, { eventId: h.eventId, actorUserId: h.users.attendeeAda, scope: { kind: 'REPORT', reportId: report.id } });
    expect(snapshot.viewer).toBe('ATTENDEE');
    const text = snapshot.facts.map((fact) => fact.statement).join(' ');
    expect(text).not.toMatch(/Ben/);
    expect(text).not.toContain('Queue reaches the door');
    expect(snapshot.recommendations).toHaveLength(0);
  });

  it('keeps a contradiction: a resolved incident beside a newer report of the same kind in the same place', async () => {
    const { h, report, reporter } = await harnessWithReport('Projector sparks when switched on', 'TECHNICAL', 'sp-main');
    const { incident } = await promoteLiveReport(h.ctx, { eventId: h.eventId, actorUserId: h.users.opsLena, reportId: report.id, category: 'TECHNICAL' });
    const version = async () => (await h.store.getIncident(incident.id))?.version ?? 0;
    await claimIncident(h.ctx, h.eventId, h.users.opsLena, incident.id, await version());
    await transitionIncident(h.ctx, { eventId: h.eventId, actorUserId: h.users.opsLena, incidentId: incident.id, to: 'ACKNOWLEDGED', expectedVersion: await version() });
    await transitionIncident(h.ctx, { eventId: h.eventId, actorUserId: h.users.opsLena, incidentId: incident.id, to: 'IN_PROGRESS', expectedVersion: await version() });
    await transitionIncident(h.ctx, { eventId: h.eventId, actorUserId: h.users.opsLena, incidentId: incident.id, to: 'RESOLVED', expectedVersion: await version(), resolutionNote: 'Replaced the cable.' });
    await transitionIncident(h.ctx, { eventId: h.eventId, actorUserId: reporter, incidentId: incident.id, to: 'CONFIRMED', expectedVersion: await version() });

    h.setNow(h.now() + 5 * MIN);
    const later = await submitLiveReport(h.ctx, { eventId: h.eventId, userId: h.users.attendeeChloe, spaceId: 'sp-main', category: 'TECHNICAL', text: 'Still sparking near the projector' });
    const snapshot = await snapshotFor(h.ctx, { eventId: h.eventId, actorUserId: h.users.opsLena, scope: { kind: 'REPORT', reportId: later.report.id } });
    expect(snapshot.facts.some((fact) => fact.kind === 'CONTRADICTED')).toBe(true);
  });
});

describe('Live updates for the new records', () => {
  it('nudges everyone for live reports and holds, with no content in the event', () => {
    const report = { id: 'lrp-1', eventId: 'e', reporterUserId: 'u', category: 'CROWD' } as unknown as LiveReport;
    const drafts = describeWrite('docPut', ['liveReports', report], undefined);
    expect(drafts).toEqual([{ eventId: 'e', topic: 'liveReports', audience: { kind: 'EVENT' } }]);
    const holdDrafts = describeWrite('docPut', ['safetyHolds', { id: 'h', eventId: 'e' }], undefined);
    expect(holdDrafts).toEqual([{ eventId: 'e', topic: 'safetyHolds', audience: { kind: 'EVENT' } }]);
  });
});
