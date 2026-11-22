import { describe, expect, it } from 'vitest';
import { correlate } from '@/domain/live/cluster';
import { CLUSTER_WINDOW_MS, cleanReportText, holdCovers, resolutionOf, validateHoldInput } from '@/domain/live/rules';
import { projectGraph } from '@/domain/graph/project';
import { compileContext } from '@/domain/graph/compile';
import type { LiveReport, SafetyHold } from '@/domain/product';

const MIN = 60 * 1000;

function report(id: string, overrides: Partial<{ spaceId: string; zone: string; category: string; createdAt: number }> = {}) {
  return { id, spaceId: 'sp-a', zone: 'Main', category: 'CROWD', createdAt: 0, ...overrides };
}

describe('correlate: place, zone and time', () => {
  it('joins a chain of reports each within the window of the next, even when the ends are further apart', () => {
    const clusters = correlate(
      [report('a', { createdAt: 0 }), report('b', { createdAt: 10 * MIN }), report('c', { createdAt: 20 * MIN })],
      CLUSTER_WINDOW_MS,
    );
    expect(clusters).toHaveLength(1);
    expect(clusters[0]?.map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });

  it('splits reports when the gap in time is larger than the window', () => {
    const clusters = correlate([report('a', { createdAt: 0 }), report('b', { createdAt: CLUSTER_WINDOW_MS + 1 })], CLUSTER_WINDOW_MS);
    expect(clusters.map((c) => c.length)).toEqual([1, 1]);
  });

  it('joins the same zone and category in different spaces, but not the same zone with a different category', () => {
    const clusters = correlate(
      [
        report('a', { spaceId: 'sp-1', zone: 'Main', category: 'CROWD', createdAt: 0 }),
        report('b', { spaceId: 'sp-2', zone: 'Main', category: 'CROWD', createdAt: MIN }),
        report('c', { spaceId: 'sp-3', zone: 'Main', category: 'TECHNICAL', createdAt: MIN }),
      ],
      CLUSTER_WINDOW_MS,
    );
    const grouped = clusters.map((c) => c.map((r) => r.id).sort().join(','));
    expect(grouped).toEqual(['a,b', 'c']);
  });

  it('keeps a report from a different place and zone apart', () => {
    const clusters = correlate([report('a', { spaceId: 'sp-1', zone: 'Main' }), report('b', { spaceId: 'sp-9', zone: 'Atrium' })], CLUSTER_WINDOW_MS);
    expect(clusters.map((c) => c.length)).toEqual([1, 1]);
  });
});

describe('live report and hold rules', () => {
  it('normalises whitespace and refuses text that is too short or too long', () => {
    expect(cleanReportText('  Water   on the   floor ')).toBe('Water on the floor');
    expect(() => cleanReportText('no')).toThrow();
    expect(() => cleanReportText('x'.repeat(501))).toThrow();
  });

  it('requires a reason and a bounded duration for a hold', () => {
    expect(() => validateHoldInput('short', 30)).toThrow();
    expect(() => validateHoldInput('A long enough reason', 0)).toThrow();
    expect(() => validateHoldInput('A long enough reason', 241)).toThrow();
    expect(validateHoldInput('  A long enough reason  ', 240)).toBe('A long enough reason');
  });

  it('covers only the scope named by a hold that is in force', () => {
    const zoneHold = { status: 'IN_FORCE' as const, scope: { kind: 'ZONE' as const, zone: 'Workshop' } };
    expect(holdCovers(zoneHold, { id: 'r', zone: 'Workshop' })).toBe(true);
    expect(holdCovers(zoneHold, { id: 'r', zone: 'Main' })).toBe(false);
    expect(holdCovers({ ...zoneHold, status: 'RELEASED' }, { id: 'r', zone: 'Workshop' })).toBe(false);
  });

  it('reads the resolution from the incident, and only treats a confirmed incident as verified', () => {
    expect(resolutionOf({ status: 'PROMOTED' }, { status: 'RESOLVED' })).toBe('RESOLUTION_PENDING_CONFIRMATION');
    expect(resolutionOf({ status: 'PROMOTED' }, { status: 'CONFIRMED' })).toBe('VERIFIED_RESOLVED');
    expect(resolutionOf({ status: 'PROMOTED' }, { status: 'TRIAGED' })).toBe('BEING_HANDLED');
    expect(resolutionOf({ status: 'DISMISSED' }, null)).toBe('DISMISSED');
  });
});

describe('context graph: provenance and fail-closed visibility', () => {
  const at = 1_000_000;
  const liveReport: LiveReport = {
    id: 'lrp-1',
    eventId: 'evt',
    reporterUserId: 'u-ben',
    category: 'TECHNICAL',
    spaceId: 'sp-main',
    zone: 'Main',
    text: 'Projector sparks',
    safetySignal: null,
    status: 'PROMOTED',
    incidentId: 'inc-1',
    createdAt: at,
    expiresAt: at + 90 * MIN,
    decisionByUserId: 'u-lena',
    decidedAt: at + MIN,
    decisionReason: 'Opened as an incident.',
    version: 2,
  };
  const hold: SafetyHold = {
    id: 'hold-1',
    eventId: 'evt',
    scope: { kind: 'ZONE', zone: 'Main' },
    reason: 'Investigating sparks',
    placedByUserId: 'u-lena',
    placedAt: at,
    decisionDueAt: at + 30 * MIN,
    status: 'IN_FORCE',
    releasedByUserId: null,
    releasedAt: null,
    releaseReason: null,
    version: 1,
  };

  function build(holdsAvailable = true) {
    return projectGraph({
      eventId: 'evt',
      now: at + 2 * MIN,
      spaces: [{ id: 'sp-main', name: 'Main Hall', roomId: 'r-main' }],
      rooms: [{ id: 'r-main', name: 'Main Hall', zone: 'Main' }],
      reports: [liveReport],
      incidents: [
        {
          id: 'inc-1',
          title: 'Projector fault',
          status: 'TRIAGED',
          category: 'FACILITIES',
          roomId: 'r-main',
          createdByUserId: 'u-ben',
          resolvedAt: null,
          createdAt: at + MIN,
          updatedAt: at + MIN,
        },
      ],
      incidentReporters: [],
      holds: [hold],
      holdsAvailable,
      people: new Map([
        ['u-ben', 'Ben'],
        ['u-lena', 'Lena'],
      ]),
    });
  }

  it('gives every fact a provenance record, and never labels an inferred link as verified', () => {
    const snapshot = compileContext(build(), {
      id: 'snap-test',
      now: at + 2 * MIN,
      viewer: { userId: 'u-lena', staff: true },
      scope: { kind: 'REPORT', reportId: 'lrp-1' },
    });
    expect(snapshot.facts.length).toBeGreaterThan(0);
    for (const fact of snapshot.facts) {
      expect(fact.provenance.length).toBeGreaterThan(0);
      if (fact.kind === 'INFERRED') {
        expect(fact.provenance.every((p) => p.verification === 'INFERRED')).toBe(true);
      }
    }
    expect(snapshot.facts.some((fact) => fact.kind === 'VERIFIED' && fact.statement.includes('Projector fault'))).toBe(true);
  });

  it('fails closed for attendees when the hold records are unknown, and tells staff the same', () => {
    const graph = build(false);
    const attendee = compileContext(graph, {
      id: 'snap-attendee',
      now: at + 2 * MIN,
      viewer: { userId: 'u-other', staff: false },
      scope: { kind: 'REPORT', reportId: 'lrp-1' },
    });
    expect(attendee.facts).toHaveLength(0);
    expect(attendee.prohibited).toContain('HOLD_STATUS_UNKNOWN');

    const staff = compileContext(graph, {
      id: 'snap-staff',
      now: at + 2 * MIN,
      viewer: { userId: 'u-lena', staff: true },
      scope: { kind: 'REPORT', reportId: 'lrp-1' },
    });
    expect(staff.missing.some((text) => text.includes('Safety holds could not be read'))).toBe(true);
  });

  it('never tells an attendee another person name or the text of another report', () => {
    const attendee = compileContext(build(), {
      id: 'snap-attendee-2',
      now: at + 2 * MIN,
      viewer: { userId: 'u-other', staff: false },
      scope: { kind: 'ZONE', zone: 'Main' },
    });
    const statements = attendee.facts.map((fact) => fact.statement).join(' ');
    expect(statements).not.toContain('Ben');
    expect(statements).not.toContain('Lena');
    expect(statements).not.toContain('Projector sparks');
  });
});
