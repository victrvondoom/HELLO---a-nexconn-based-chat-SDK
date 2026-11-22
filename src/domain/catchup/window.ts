/**
 * "What's new since you left": the time window and the wording.
 *
 * Pure rules: no storage and no clock. A missed day is never held against anyone, so there is no streak and no
 * count of days away; the window is simply capped so the page stays short.
 */
export const CATCHUP_MAX_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/** The cookie value is read from the browser, so it is untrusted: anything that is not a sane past time is ignored. */
export function parseLastSeen(raw: string | undefined, now: number): number | null {
  if (!raw || !/^\d{10,15}$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value > 0 && value <= now ? value : null;
}

/** Where the window starts. A first visit has nothing to catch up on, so it returns null. */
export function catchUpSince(lastSeen: number | null, now: number): number | null {
  if (lastSeen === null) return null;
  return Math.max(lastSeen, now - CATCHUP_MAX_WINDOW_MS);
}

export function catchUpHeadline(newPosts: number, newNotifications: number): string {
  if (newPosts === 0 && newNotifications === 0) return 'Nothing new since you left.';
  const parts: string[] = [];
  if (newPosts > 0) parts.push(`${newPosts} new ${newPosts === 1 ? 'post' : 'posts'}`);
  if (newNotifications > 0) parts.push(`${newNotifications} ${newNotifications === 1 ? 'update' : 'updates'} for you`);
  return `${parts.join(' and ')} since you left.`;
}

export function seenCookieName(eventId: string): string {
  return `hello_seen_${eventId.replace(/[^A-Za-z0-9_-]/g, '')}`;
}
