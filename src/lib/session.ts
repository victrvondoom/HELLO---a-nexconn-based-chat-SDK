import { cookies } from 'next/headers';

/**
 * DEMO SESSION ONLY.
 *
 * The demo picks one of the seeded demo accounts and stores its id in a cookie.
 * This is NOT an authentication system: anyone who can set a cookie can become
 * any demo user. It is available only when HELLO_DEMO_MODE=true, or when the app
 * is not running in production (so local development works out of the box).
 * Production must replace this module with real authentication (see docs/security.md).
 */
export const DEMO_SESSION_COOKIE = 'hello_demo_user';

export function demoModeEnabled(): boolean {
  const explicit = process.env.HELLO_DEMO_MODE;
  if (explicit === 'true') return true;
  if (explicit === 'false') return false;
  return process.env.NODE_ENV !== 'production';
}

/** The signed-in viewer's user id, or null. Never trusts a role sent by the browser. */
export async function currentUserId(): Promise<string | null> {
  if (!demoModeEnabled()) return null;
  const jar = await cookies();
  const value = jar.get(DEMO_SESSION_COOKIE)?.value;
  return value && /^u-[a-z0-9-]{1,40}$/.test(value) ? value : null;
}
