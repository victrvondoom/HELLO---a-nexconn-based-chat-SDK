import type { IncidentCategory, SignalPattern } from '../types';

/**
 * HELLO Signal Intelligence: detect clusters of independent reports.
 *
 * Input is only real, stored reports (each with the reporter, time, room and
 * category of the incident it belongs to). A pattern needs at least
 * `minDistinctReporters` different people inside one window. Repeated reports
 * from the same person never count twice. The output is a suggestion that always
 * waits for human review; nothing here changes an incident or sends a message.
 */

export const SIGNAL_WINDOW_MS = 10 * 60 * 1000;
export const MIN_DISTINCT_REPORTERS = 3;

export interface SignalReport {
  reportId: string;
  incidentId: string;
  reporterUserId: string;
  roomId: string | null;
  roomName: string | null;
  category: IncidentCategory;
  createdAt: number;
}

export interface DetectOptions {
  eventId: string;
  windowMs?: number;
  minDistinctReporters?: number;
}

const RECOMMENDATIONS: Record<IncidentCategory, string> = {
  AV: 'Dispatch an AV inspection to the room before the next session starts.',
  CAPACITY: 'Check occupancy and offer alternative sessions to people who cannot find seats.',
  ACCESSIBILITY: 'Verify the accessible route and place a steward at the access point.',
  FACILITIES: 'Send facilities to inspect the area and confirm the fault.',
  SCHEDULE: 'Publish a schedule clarification to the affected sessions (requires organiser approval).',
  GENERAL: 'Review the reports and decide whether a specific team should respond.',
};

export function confidenceFor(distinctReporters: number, roomKnown: boolean, minDistinct: number): number {
  // Three distinct reporters is the minimum signal. Confidence grows with each extra
  // independent reporter and is capped below 1: a pattern is never treated as certain.
  const extra = Math.max(0, distinctReporters - minDistinct);
  const base = 0.6 + 0.1 * extra;
  const capped = Math.min(0.9, base);
  return Math.round((roomKnown ? capped : capped * 0.7) * 100) / 100;
}

/**
 * Finds every window in which at least `minDistinctReporters` different people reported
 * the same category in the same room. Patterns are returned with a deterministic id so
 * recomputing the same data never creates duplicate suggestions.
 */
export function detectPatterns(reports: readonly SignalReport[], options: DetectOptions): SignalPattern[] {
  const windowMs = options.windowMs ?? SIGNAL_WINDOW_MS;
  const minDistinct = options.minDistinctReporters ?? MIN_DISTINCT_REPORTERS;

  const groups = new Map<string, SignalReport[]>();
  for (const report of reports) {
    const key = `${report.roomId ?? 'no-room'}|${report.category}`;
    const bucket = groups.get(key) ?? [];
    bucket.push(report);
    groups.set(key, bucket);
  }

  const patterns: SignalPattern[] = [];
  for (const [key, bucket] of groups) {
    const sorted = [...bucket].sort((a, b) => a.createdAt - b.createdAt || a.reportId.localeCompare(b.reportId));
    let best: { members: SignalReport[]; start: number } | null = null;

    for (let i = 0; i < sorted.length; i += 1) {
      const anchor = sorted[i];
      if (!anchor) {
        continue;
      }
      const members = sorted.filter((r) => r.createdAt >= anchor.createdAt && r.createdAt <= anchor.createdAt + windowMs);
      const distinct = new Set(members.map((m) => m.reporterUserId)).size;
      if (distinct >= minDistinct && (!best || distinct > new Set(best.members.map((m) => m.reporterUserId)).size)) {
        best = { members, start: anchor.createdAt };
      }
    }

    if (!best) {
      continue;
    }
    const first = best.members[0];
    if (!first) {
      continue;
    }
    const distinctReporters = new Set(best.members.map((m) => m.reporterUserId)).size;
    const roomKnown = first.roomId !== null;
    const roomLabel = first.roomName ?? 'an unknown room';
    const minutes = Math.round(windowMs / 60000);
    const categoryLabel = first.category.toLowerCase();
    const explanation =
      `${distinctReporters} independent reporters submitted ${best.members.length} ${categoryLabel} ` +
      `report${best.members.length === 1 ? '' : 's'} about ${roomLabel} within ${minutes} minutes. ` +
      'Reports are counted once per person, and the list below shows the stored records they came from.';

    patterns.push({
      id: `${options.eventId}:${key}:${best.start}`,
      eventId: options.eventId,
      scope: { roomId: first.roomId, category: first.category },
      windowStart: best.start,
      windowEnd: best.start + windowMs,
      distinctReporters,
      reportIds: best.members.map((m) => m.reportId).sort(),
      incidentIds: [...new Set(best.members.map((m) => m.incidentId))].sort(),
      confidence: confidenceFor(distinctReporters, roomKnown, minDistinct),
      explanation,
      recommendation: RECOMMENDATIONS[first.category],
      reviewStatus: 'PENDING_REVIEW',
      reviewedByUserId: null,
      reviewedAt: null,
    });
  }

  return patterns.sort((a, b) => b.confidence - a.confidence || a.id.localeCompare(b.id));
}
