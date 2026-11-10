import type { Incident, Urgency } from '../types';

/**
 * Acknowledgement targets. A target is the time within which a staff member should acknowledge
 * an incident. Targets are computed from urgency every time they are read, so timers keep moving.
 */
export const ACK_TARGET_MINUTES: Record<Urgency, number> = {
  CRITICAL: 5,
  HIGH: 10,
  MEDIUM: 30,
  LOW: 60,
};

export type SlaState = 'MET' | 'ON_TRACK' | 'AT_RISK' | 'BREACHED' | 'NOT_APPLICABLE';

export interface SlaSnapshot {
  state: SlaState;
  targetMinutes: number;
  /** Minutes since the incident was opened, or the minutes it took to acknowledge. */
  elapsedMinutes: number;
  /** Negative when the target has been passed. Null when no clock is running. */
  remainingMinutes: number | null;
  label: string;
}

const CLOCK_STOPPED: ReadonlyArray<Incident['status']> = ['NEEDS_INFORMATION', 'RESOLVED', 'CONFIRMED', 'CLOSED', 'CANCELLED'];

export function slaFor(
  incident: Pick<Incident, 'urgency' | 'createdAt' | 'acknowledgedAt' | 'status'>,
  now: number,
): SlaSnapshot {
  const targetMinutes = ACK_TARGET_MINUTES[incident.urgency];

  if (incident.acknowledgedAt !== null) {
    const took = Math.round((incident.acknowledgedAt - incident.createdAt) / 60000);
    const late = took > targetMinutes;
    return {
      state: late ? 'BREACHED' : 'MET',
      targetMinutes,
      elapsedMinutes: took,
      remainingMinutes: null,
      label: late ? `Acknowledged ${took - targetMinutes} min late` : `Acknowledged in ${took} min`,
    };
  }

  if (CLOCK_STOPPED.includes(incident.status)) {
    return {
      state: 'NOT_APPLICABLE',
      targetMinutes,
      elapsedMinutes: Math.max(0, Math.round((now - incident.createdAt) / 60000)),
      remainingMinutes: null,
      label: 'No acknowledgement timer',
    };
  }

  const elapsedMinutes = Math.max(0, Math.floor((now - incident.createdAt) / 60000));
  const remainingMinutes = targetMinutes - elapsedMinutes;
  if (remainingMinutes < 0) {
    return {
      state: 'BREACHED',
      targetMinutes,
      elapsedMinutes,
      remainingMinutes,
      label: `Overdue by ${Math.abs(remainingMinutes)} min`,
    };
  }
  if (remainingMinutes <= Math.ceil(targetMinutes * 0.25)) {
    return {
      state: 'AT_RISK',
      targetMinutes,
      elapsedMinutes,
      remainingMinutes,
      label: `${remainingMinutes} min to acknowledge`,
    };
  }
  return {
    state: 'ON_TRACK',
    targetMinutes,
    elapsedMinutes,
    remainingMinutes,
    label: `${remainingMinutes} min to acknowledge`,
  };
}

/** Incidents that have passed their acknowledgement target and nobody has taken them yet. */
export function isEscalationCandidate(
  incident: Pick<Incident, 'urgency' | 'createdAt' | 'acknowledgedAt' | 'status'>,
  now: number,
): boolean {
  if (incident.status !== 'TRIAGED' && incident.status !== 'ASSIGNED') return false;
  return slaFor(incident, now).state === 'BREACHED';
}
