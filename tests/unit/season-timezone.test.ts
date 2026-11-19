import { describe, expect, it } from 'vitest';
import { monthWindow, zoneOffsetMs } from '@/domain/field/rules';

describe('seasons follow the event’s time zone', () => {
  it('keeps UTC months unchanged', () => {
    expect(monthWindow(2026, 11)).toEqual({ startsAt: Date.UTC(2026, 10, 1), endsAt: Date.UTC(2026, 11, 1) - 1 });
  });

  it('starts a Tokyo month at midnight in Tokyo', () => {
    const w = monthWindow(2026, 11, 'Asia/Tokyo');
    expect(new Date(w.startsAt).toISOString()).toBe('2026-10-31T15:00:00.000Z');
    expect(new Date(w.endsAt + 1).toISOString()).toBe('2026-11-30T15:00:00.000Z');
  });

  it('handles a daylight-saving change inside the month (New York, March)', () => {
    const w = monthWindow(2026, 3, 'America/New_York');
    expect(new Date(w.startsAt).toISOString()).toBe('2026-03-01T05:00:00.000Z'); // EST
    expect(new Date(w.endsAt + 1).toISOString()).toBe('2026-04-01T04:00:00.000Z'); // EDT
    expect(zoneOffsetMs('America/New_York', Date.UTC(2026, 6, 1))).toBe(-4 * 3600_000);
  });

  it('rolls December into January, and refuses an unknown zone', () => {
    expect(new Date(monthWindow(2026, 12, 'Europe/Paris').endsAt + 1).toISOString()).toBe('2026-12-31T23:00:00.000Z');
    expect(() => monthWindow(2026, 1, 'Mars/Olympus')).toThrow(RangeError);
  });
});
