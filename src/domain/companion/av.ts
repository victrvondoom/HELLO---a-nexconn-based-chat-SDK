import type { AvSignal, AvSignalKind } from '../product';

/**
 * AV signal aggregation. "Can't hear" and "Can't see" are operational signals, not chat. One person counts
 * once however often they tap (their signal is one document, overwritten). An AV incident is raised when at
 * least `threshold` distinct people report the same problem in the same session within `windowMs`.
 */
export const AV_THRESHOLD = 3;
export const AV_WINDOW_MS = 60_000;

export interface AvDecision {
  distinct: number;
  /** People in the window not yet counted into an incident. */
  uncounted: string[];
  raise: boolean;
}

export function aggregateAv(signals: readonly AvSignal[], sessionId: string, kind: AvSignalKind, now: number, threshold = AV_THRESHOLD, windowMs = AV_WINDOW_MS): AvDecision {
  const recent = signals.filter((s) => s.sessionId === sessionId && s.kind === kind && s.better !== true && now - s.at <= windowMs && s.at <= now);
  const people = [...new Set(recent.map((s) => s.userId))];
  const uncounted = [...new Set(recent.filter((s) => s.incidentId === null).map((s) => s.userId))];
  return { distinct: people.length, uncounted, raise: uncounted.length >= threshold };
}

export const AV_LABEL: Record<AvSignalKind, string> = { CANT_HEAR: "can't hear", CANT_SEE: "can't see" };
