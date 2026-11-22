import { DomainError } from '../errors';
import type { HoldScope, LiveReport, SafetyHold } from '../product';
import type { IncidentCategory, IncidentStatus } from '../types';

/**
 * LiveScene and LiveShield rules. Pure: no storage and no clock. Every time is passed in.
 *
 * A live report describes a place on the venue map. It is not a person's position, and it is not an
 * incident until staff promote it. It leaves the live view when its time to live ends, but it stays in
 * the staff record.
 */

export const LIVE_CATEGORIES = ['SAFETY', 'TECHNICAL', 'CROWD', 'SOCIAL', 'COMMUNITY', 'ACCESSIBILITY'] as const;
export type LiveCategory = (typeof LIVE_CATEGORIES)[number];

/** How long a report stays in the live view. Chosen per category; a report never lives longer than this. */
export const LIVE_TTL_MINUTES: Record<LiveCategory, number> = {
  SAFETY: 60,
  TECHNICAL: 90,
  CROWD: 30,
  SOCIAL: 60,
  COMMUNITY: 120,
  ACCESSIBILITY: 120,
};

export const LIVE_CATEGORY_LABEL: Record<LiveCategory, string> = {
  SAFETY: 'Safety',
  TECHNICAL: 'Technical',
  CROWD: 'Crowding',
  SOCIAL: 'Social activity',
  COMMUNITY: 'Community event',
  ACCESSIBILITY: 'Accessibility',
};

/** Categories staff may promote to an incident, and the incident category each one becomes. */
const PROMOTION: Partial<Record<LiveCategory, IncidentCategory>> = {
  SAFETY: 'GENERAL',
  TECHNICAL: 'FACILITIES',
  CROWD: 'CAPACITY',
  ACCESSIBILITY: 'ACCESSIBILITY',
};

export function promotionCategoryFor(category: LiveCategory): IncidentCategory | null {
  return PROMOTION[category] ?? null;
}

export const MIN_REPORT_TEXT = 4;
export const MAX_REPORT_TEXT = 500;
/** The same person cannot send the same text for the same place within this window. */
export const DUPLICATE_WINDOW_MS = 10 * 60 * 1000;
/** Reports at one place, or in one zone for one category, within this window are correlated. */
export const CLUSTER_WINDOW_MS = 15 * 60 * 1000;
export const MIN_HOLD_REASON = 10;
export const MAX_HOLD_MINUTES = 240;
export const MIN_DECISION_REASON = 5;

const MINUTE = 60 * 1000;

export function cleanReportText(text: string): string {
  const cleaned = text.trim().replace(/\s+/g, ' ');
  if (cleaned.length < MIN_REPORT_TEXT || cleaned.length > MAX_REPORT_TEXT) {
    throw new DomainError('VALIDATION_FAILED', `Describe the problem in ${MIN_REPORT_TEXT} to ${MAX_REPORT_TEXT} characters.`);
  }
  return cleaned;
}

export function expiryFor(category: LiveCategory, createdAt: number): number {
  return createdAt + LIVE_TTL_MINUTES[category] * MINUTE;
}

/** Live: not dismissed and not expired. Promotion or resolution does not remove a report from the live view. */
export function isLive(report: Pick<LiveReport, 'status' | 'expiresAt'>, now: number): boolean {
  return report.status !== 'DISMISSED' && now < report.expiresAt;
}

export function isExpired(report: Pick<LiveReport, 'expiresAt'>, now: number): boolean {
  return now >= report.expiresAt;
}

/** A Sentinel-flagged report needs a moderator decision (promote or dismiss) before it leaves the queue. */
export function needsDecision(report: Pick<LiveReport, 'safetySignal' | 'decidedAt' | 'status'>): boolean {
  return report.safetySignal !== null && report.decidedAt === null && report.status !== 'DISMISSED';
}

export function scopeKey(scope: HoldScope): string {
  switch (scope.kind) {
    case 'EVENT':
      return 'EVENT';
    case 'ZONE':
      return `ZONE:${scope.zone}`;
    case 'REPORT':
      return `REPORT:${scope.reportId}`;
  }
}

/** A hold covers a report when its scope contains it. Only holds in force cover anything. */
export function holdCovers(hold: Pick<SafetyHold, 'status' | 'scope'>, report: Pick<LiveReport, 'id' | 'zone'>): boolean {
  if (hold.status !== 'IN_FORCE') return false;
  switch (hold.scope.kind) {
    case 'EVENT':
      return true;
    case 'ZONE':
      return hold.scope.zone === report.zone;
    case 'REPORT':
      return hold.scope.reportId === report.id;
  }
}

export function holdCoveringReport(holds: readonly SafetyHold[], report: Pick<LiveReport, 'id' | 'zone'>): SafetyHold | null {
  return holds.find((hold) => holdCovers(hold, report)) ?? null;
}

/**
 * A hold is overdue once its decision time has passed. It stays in force: overdue means "someone must
 * decide", never "restore visibility". Only a release decision restores visibility.
 */
export function holdOverdue(hold: Pick<SafetyHold, 'status' | 'decisionDueAt'>, now: number): boolean {
  return hold.status === 'IN_FORCE' && now >= hold.decisionDueAt;
}

export function validateHoldInput(reason: string, durationMinutes: number): string {
  const cleaned = reason.trim();
  if (cleaned.length < MIN_HOLD_REASON) {
    throw new DomainError('VALIDATION_FAILED', `Give the reason in at least ${MIN_HOLD_REASON} characters.`);
  }
  if (!Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > MAX_HOLD_MINUTES) {
    throw new DomainError('VALIDATION_FAILED', `A hold lasts between 1 and ${MAX_HOLD_MINUTES} minutes before someone must decide.`);
  }
  return cleaned;
}

export type ResolutionState = 'REPORTED' | 'BEING_HANDLED' | 'RESOLUTION_PENDING_CONFIRMATION' | 'VERIFIED_RESOLVED' | 'CANCELLED' | 'DISMISSED';

/**
 * How a report's problem stands. It is read from the linked incident every time and never copied, so the
 * incident stays the single source of truth. "Verified" means the reporter confirmed the resolution.
 */
export function resolutionOf(report: Pick<LiveReport, 'status'>, incident: { status: IncidentStatus } | null): ResolutionState {
  if (report.status === 'DISMISSED') return 'DISMISSED';
  if (!incident) return report.status === 'PROMOTING' ? 'BEING_HANDLED' : 'REPORTED';
  switch (incident.status) {
    case 'CONFIRMED':
    case 'CLOSED':
      return 'VERIFIED_RESOLVED';
    case 'RESOLVED':
      return 'RESOLUTION_PENDING_CONFIRMATION';
    case 'CANCELLED':
      return 'CANCELLED';
    default:
      return 'BEING_HANDLED';
  }
}

export function minutesBetween(later: number, earlier: number): number {
  return Math.max(0, Math.floor((later - earlier) / MINUTE));
}
