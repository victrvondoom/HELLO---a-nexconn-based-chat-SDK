import { describe, expect, it } from 'vitest';
import { ACK_TARGET_MINUTES, isEscalationCandidate, slaFor } from '@/domain/incidents/sla';

const T = Date.UTC(2026, 10, 10, 12, 0);
const minutes = (m: number) => m * 60_000;

function inc(overrides: Partial<{ urgency: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'; createdAt: number; acknowledgedAt: number | null; status: 'TRIAGED' | 'ASSIGNED' | 'RESOLVED' | 'NEEDS_INFORMATION' | 'ACKNOWLEDGED' }> = {}) {
  return { urgency: 'HIGH' as const, createdAt: T, acknowledgedAt: null, status: 'TRIAGED' as const, ...overrides };
}

describe('acknowledgement SLA', () => {
  it('derives the target from urgency', () => {
    expect(ACK_TARGET_MINUTES.CRITICAL).toBeLessThan(ACK_TARGET_MINUTES.HIGH);
    expect(ACK_TARGET_MINUTES.HIGH).toBeLessThan(ACK_TARGET_MINUTES.MEDIUM);
  });

  it('moves from on track to at risk to breached as time passes', () => {
    expect(slaFor(inc(), T + minutes(1)).state).toBe('ON_TRACK');
    expect(slaFor(inc(), T + minutes(8)).state).toBe('AT_RISK');
    const late = slaFor(inc(), T + minutes(12));
    expect(late.state).toBe('BREACHED');
    expect(late.label).toBe('Overdue by 2 min');
  });

  it('records how late an acknowledgement was, and whether it was met', () => {
    expect(slaFor(inc({ acknowledgedAt: T + minutes(4), status: 'ASSIGNED' }), T + minutes(30)).state).toBe('MET');
    const late = slaFor(inc({ acknowledgedAt: T + minutes(15), status: 'ACKNOWLEDGED' }), T + minutes(30));
    expect(late.state).toBe('BREACHED');
    expect(late.label).toBe('Acknowledged 5 min late');
  });

  it('stops the clock while the reporter is being asked for information, or once resolved', () => {
    expect(slaFor(inc({ status: 'NEEDS_INFORMATION' }), T + minutes(90)).state).toBe('NOT_APPLICABLE');
    expect(slaFor(inc({ status: 'RESOLVED' }), T + minutes(90)).state).toBe('NOT_APPLICABLE');
  });

  it('only escalates unclaimed work that has breached', () => {
    expect(isEscalationCandidate(inc(), T + minutes(15))).toBe(true);
    expect(isEscalationCandidate(inc(), T + minutes(5))).toBe(false);
    expect(isEscalationCandidate(inc({ status: 'ACKNOWLEDGED', acknowledgedAt: T + minutes(1) }), T + minutes(60))).toBe(false);
  });
});
