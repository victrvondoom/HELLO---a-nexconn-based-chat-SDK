import { describe, expect, it } from 'vitest';
import { detectPatterns, MIN_DISTINCT_REPORTERS, SIGNAL_WINDOW_MS, type SignalReport } from '@/domain/intelligence/signals';
import { buildDedupeKey, claimNotificationKey, InMemoryDedupeStore } from '@/domain/notifications/dedupe';

const T = Date.UTC(2026, 10, 10, 12, 0);

function r(id: string, reporter: string, offsetMs: number, roomId: string | null = 'r-3', category: SignalReport['category'] = 'AV'): SignalReport {
  return {
    reportId: id,
    incidentId: 'inc-1',
    reporterUserId: reporter,
    roomId,
    roomName: roomId ? 'Room 3' : null,
    category,
    createdAt: T + offsetMs,
  };
}

describe('signal intelligence', () => {
  it('detects a pattern only when enough independent people report the same thing', () => {
    const patterns = detectPatterns(
      [r('1', 'ann', 0), r('2', 'ben', 60_000), r('3', 'cy', 120_000)],
      { eventId: 'evt' },
    );
    expect(patterns).toHaveLength(1);
    expect(patterns[0]?.distinctReporters).toBe(MIN_DISTINCT_REPORTERS);
    expect(patterns[0]?.reviewStatus).toBe('PENDING_REVIEW');
    expect(patterns[0]?.explanation).toContain('3 independent reporters');
    expect(patterns[0]?.reportIds).toEqual(['1', '2', '3']);
  });

  it('counts a repeat from one person only once', () => {
    const patterns = detectPatterns(
      [r('1', 'ann', 0), r('2', 'ann', 30_000), r('3', 'ann', 60_000), r('4', 'ben', 90_000)],
      { eventId: 'evt' },
    );
    expect(patterns).toHaveLength(0);
  });

  it('does not combine reports from different rooms or categories', () => {
    const patterns = detectPatterns(
      [r('1', 'ann', 0, 'r-3'), r('2', 'ben', 0, 'r-2'), r('3', 'cy', 0, 'r-3', 'CAPACITY')],
      { eventId: 'evt' },
    );
    expect(patterns).toHaveLength(0);
  });

  it('ignores reports spread across more than the window', () => {
    const patterns = detectPatterns(
      [r('1', 'ann', 0), r('2', 'ben', SIGNAL_WINDOW_MS / 2), r('3', 'cy', SIGNAL_WINDOW_MS + 1)],
      { eventId: 'evt' },
    );
    expect(patterns).toHaveLength(0);
  });

  it('caps confidence below certainty and lowers it when the room is unknown', () => {
    const many = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => r(`x${i}`, `p${i}`, i * 1000));
    const known = detectPatterns(many, { eventId: 'evt' })[0];
    expect(known?.confidence).toBeLessThanOrEqual(0.9);
    const unknownRoom = detectPatterns(
      [r('1', 'ann', 0, null), r('2', 'ben', 1000, null), r('3', 'cy', 2000, null)],
      { eventId: 'evt' },
    )[0];
    expect(unknownRoom?.confidence).toBeLessThan(0.6);
  });

  it('produces deterministic ids so recomputation does not duplicate suggestions', () => {
    const data = [r('1', 'ann', 0), r('2', 'ben', 1000), r('3', 'cy', 2000)];
    const first = detectPatterns(data, { eventId: 'evt' });
    const second = detectPatterns([...data].reverse(), { eventId: 'evt' });
    expect(first[0]?.id).toBe(second[0]?.id);
  });
});

describe('notification deduplication', () => {
  it('claims a key only once', () => {
    const store = new InMemoryDedupeStore();
    const key = buildDedupeKey(['INCIDENT_UPDATE', 'u-1', 'inc-1', 'RESOLVED', 3]);
    expect(claimNotificationKey(store, key)).toBe(true);
    expect(claimNotificationKey(store, key)).toBe(false);
    expect(store.size).toBe(1);
  });

  it('treats a new incident state as a new notification', () => {
    const store = new InMemoryDedupeStore();
    expect(claimNotificationKey(store, buildDedupeKey(['u', 'inc', 'IN_PROGRESS']))).toBe(true);
    expect(claimNotificationKey(store, buildDedupeKey(['u', 'inc', 'RESOLVED']))).toBe(true);
  });
});
