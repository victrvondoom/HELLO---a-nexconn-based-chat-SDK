/**
 * Temporal event intelligence (pattern: server-time-authoritative timelines with replay). Pure and deterministic:
 * every function takes the server's time as an argument. A device clock is never the source of truth; a client
 * converts with `serverNow(deviceNow, offset)` where the offset was measured against the server.
 *
 *   intendedAt  when the event happens in the programme (event start + schedule offset)
 *   releaseAt   when the message may be shown (controlled or delayed release); ≥ serverAt
 *   serverAt    when the server accepted it (authoritative)
 *   seq         monotonic per timeline; ordering and gap detection use it
 */
export interface TimelineEvent {
  id: string;
  seq: number;
  serverAt: number;
  intendedAt: number;
  releaseAt: number;
  kind: 'ANNOUNCEMENT' | 'SCHEDULE_CHANGE' | 'INCIDENT' | 'MESSAGE';
  text: string;
}

export const eventTime = (eventStartAt: number, offsetMinutes: number) => eventStartAt + offsetMinutes * 60_000;
export const serverNow = (deviceNow: number, measuredOffsetMs: number) => deviceNow + measuredOffsetMs;

/** Canonical order: intended time, then sequence. Independent of arrival order. */
export const compareEvents = (a: TimelineEvent, b: TimelineEvent) => a.intendedAt - b.intendedAt || a.seq - b.seq;

/** Inserts an event that may arrive late or twice. A repeated id is a duplicate and changes nothing. */
export function insertEvent(timeline: readonly TimelineEvent[], event: TimelineEvent): { timeline: TimelineEvent[]; duplicate: boolean } {
  if (timeline.some((e) => e.id === event.id || e.seq === event.seq)) return { timeline: [...timeline], duplicate: true };
  return { timeline: [...timeline, event].sort(compareEvents), duplicate: false };
}

/** What a person may see at server time `now`: released events only, in canonical order. */
export function visibleAt(timeline: readonly TimelineEvent[], now: number): TimelineEvent[] {
  return timeline.filter((e) => e.releaseAt <= now).sort(compareEvents);
}

/** Catch-up for a late joiner or a reconnect: released events after the person's cursor, in sequence order. */
export function catchUp(timeline: readonly TimelineEvent[], cursorSeq: number, now: number): { events: TimelineEvent[]; cursor: number } {
  const events = timeline.filter((e) => e.seq > cursorSeq && e.releaseAt <= now).sort((a, b) => a.seq - b.seq);
  return { events, cursor: events.reduce((c, e) => Math.max(c, e.seq), cursorSeq) };
}

/** Sequence numbers missing between the cursor and the highest seen: these must be re-fetched. */
export function gaps(receivedSeqs: readonly number[], cursorSeq: number): number[] {
  const seen = new Set(receivedSeqs);
  const high = Math.max(cursorSeq, ...receivedSeqs);
  const missing: number[] = [];
  for (let s = cursorSeq + 1; s <= high; s += 1) if (!seen.has(s)) missing.push(s);
  return missing;
}

/** Validates a delayed release: never before the server accepted it. */
export function scheduleRelease(serverAt: number, intendedAt: number, delayMs: number): number {
  return Math.max(serverAt, intendedAt + delayMs);
}
