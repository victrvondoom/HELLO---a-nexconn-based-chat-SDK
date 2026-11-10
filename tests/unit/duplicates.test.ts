import { describe, expect, it } from 'vitest';
import {
  AUTO_ATTACH_CONFIDENCE,
  DUPLICATE_WINDOW_MS,
  assessDuplicate,
  findDuplicate,
  textSimilarity,
  type CandidateContext,
} from '@/domain/incidents/duplicates';
import type { Incident, IncidentReport } from '@/domain/types';

const NOW = Date.UTC(2026, 10, 10, 12, 0);

function incident(overrides: Partial<Incident> = {}): Incident {
  return {
    id: 'inc-1',
    eventId: 'evt',
    category: 'AV',
    status: 'TRIAGED',
    urgency: 'MEDIUM',
    title: 'Microphone fault in Room 3',
    roomId: 'r-3',
    sessionId: null,
    equipment: ['microphone'],
    createdByUserId: 'u-1',
    assigneeUserId: null,
    version: 1,
    createdAt: NOW - 5 * 60 * 1000,
    updatedAt: NOW - 5 * 60 * 1000,
    acknowledgedAt: null,
    resolvedAt: null,
    confirmedAt: null,
    resolutionNote: null,
    ...overrides,
  };
}

function report(text: string): IncidentReport {
  return {
    id: 'rpt-1',
    incidentId: 'inc-1',
    eventId: 'evt',
    reporterUserId: 'u-1',
    text,
    createdAt: NOW - 5 * 60 * 1000,
    matchConfidence: 1,
    matchSignals: [],
  };
}

const incoming = {
  eventId: 'evt',
  roomId: 'r-3',
  category: 'AV',
  equipment: ['microphone'],
  text: 'The microphone in Room 3 is not working',
  at: NOW,
};

describe('duplicate detection', () => {
  it('attaches a clearly matching report in the same room, category and window', () => {
    const candidate: CandidateContext = { incident: incident(), reports: [report('Microphone crackling in Room 3')] };
    const a = assessDuplicate(incoming, candidate, NOW);
    expect(a.eligibleForAttach).toBe(true);
    expect(a.confidence).toBeGreaterThanOrEqual(AUTO_ATTACH_CONFIDENCE);
    expect(a.signals).toEqual(expect.arrayContaining(['same-room', 'same-category', 'shared-equipment']));
  });

  it('never merges across rooms, even with identical wording', () => {
    const candidate: CandidateContext = { incident: incident({ roomId: 'r-2' }), reports: [report(incoming.text)] };
    const a = assessDuplicate(incoming, candidate, NOW);
    expect(a.eligibleForAttach).toBe(false);
    expect(a.blockedBy).toContain('room-differs-or-unknown');
  });

  it('never merges across categories', () => {
    const candidate: CandidateContext = { incident: incident({ category: 'CAPACITY' }), reports: [] };
    expect(assessDuplicate(incoming, candidate, NOW).blockedBy).toContain('category-differs');
  });

  it('refuses incidents outside the 30 minute window', () => {
    const stale = incident({ updatedAt: NOW - DUPLICATE_WINDOW_MS - 60_000 });
    const a = assessDuplicate(incoming, { incident: stale, reports: [] }, NOW);
    expect(a.eligibleForAttach).toBe(false);
    expect(a.blockedBy).toContain('outside-time-window');
  });

  it('refuses closed incidents', () => {
    const closed = incident({ status: 'CLOSED' });
    expect(assessDuplicate(incoming, { incident: closed, reports: [] }, NOW).blockedBy).toContain('incident-not-open');
  });

  it('keeps two different faults in the same room apart when their equipment is disjoint', () => {
    const projectorIncoming = { ...incoming, equipment: ['projector'], text: 'projector is flickering' };
    const candidate: CandidateContext = { incident: incident(), reports: [report('Microphone crackling')] };
    const a = assessDuplicate(projectorIncoming, candidate, NOW);
    expect(a.eligibleForAttach).toBe(false);
    expect(a.blockedBy).toContain('different-equipment');
  });

  it('picks the highest-confidence eligible candidate and ignores ineligible ones', () => {
    const wrongRoom: CandidateContext = { incident: incident({ id: 'inc-x', roomId: 'r-2' }), reports: [] };
    const right: CandidateContext = { incident: incident({ id: 'inc-y' }), reports: [report(incoming.text)] };
    expect(findDuplicate(incoming, [wrongRoom, right], NOW)?.incidentId).toBe('inc-y');
    expect(findDuplicate(incoming, [wrongRoom], NOW)).toBeNull();
  });

  it('measures description similarity on content words only', () => {
    expect(textSimilarity('microphone crackling in room 3', 'microphone crackling room 3')).toBeGreaterThan(0.5);
    expect(textSimilarity('the and of', 'is a it')).toBe(0);
  });
});
