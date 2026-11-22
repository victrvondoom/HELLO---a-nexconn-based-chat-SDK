import { describe, expect, it } from 'vitest';
import { CATCHUP_MAX_WINDOW_MS, catchUpHeadline, catchUpSince, parseLastSeen, seenCookieName } from '@/domain/catchup/window';

const NOW = 1_800_000_000_000;

describe('catch-up window', () => {
  it('has no window on a first visit', () => {
    expect(catchUpSince(null, NOW)).toBeNull();
  });
  it('starts at the last visit, but never further back than a week', () => {
    expect(catchUpSince(NOW - 1000, NOW)).toBe(NOW - 1000);
    expect(catchUpSince(NOW - 30 * 24 * 3600 * 1000, NOW)).toBe(NOW - CATCHUP_MAX_WINDOW_MS);
  });
  it('ignores a cookie that is not a sane past time', () => {
    expect(parseLastSeen(undefined, NOW)).toBeNull();
    expect(parseLastSeen('abc', NOW)).toBeNull();
    expect(parseLastSeen(String(NOW + 5000), NOW)).toBeNull();
    expect(parseLastSeen('-5', NOW)).toBeNull();
    expect(parseLastSeen(String(NOW - 5000), NOW)).toBe(NOW - 5000);
  });
  it('words the headline honestly', () => {
    expect(catchUpHeadline(0, 0)).toBe('Nothing new since you left.');
    expect(catchUpHeadline(1, 0)).toBe('1 new post since you left.');
    expect(catchUpHeadline(3, 2)).toBe('3 new posts and 2 updates for you since you left.');
  });
  it('keeps the cookie name safe', () => {
    expect(seenCookieName('ev-1;x=y')).toBe('hello_seen_ev-1xy');
  });
});
