import { cookies } from 'next/headers';
import { getRuntime } from './runtime';
import { endSession, sessionUser, SESSION_MAX_AGE_SECONDS, startSession } from '@/services/auth';

/**
 * Sessions.
 *
 * The cookie holds a random token; the server stores only its hash and looks the user up on every
 * request (src/services/auth.ts). The cookie is HttpOnly, SameSite=Lax and Secure in production.
 *
 * Two ways to get a session:
 * - Sign in with a registered account (handle and password). Always available.
 * - Demo sign-in as a seeded, fictional person. Available only when demo mode is on, and sessions
 *   for seeded people stop being honoured the moment demo mode is turned off.
 */
export const SESSION_COOKIE = 'hello_session';

export function demoModeEnabled(): boolean {
  const explicit = process.env.HELLO_DEMO_MODE;
  if (explicit === 'true') return true;
  if (explicit === 'false') return false;
  return process.env.NODE_ENV !== 'production';
}

async function readToken(): Promise<string | null> {
  const value = (await cookies()).get(SESSION_COOKIE)?.value;
  return value && /^[A-Za-z0-9_-]{43}$/.test(value) ? value : null;
}

/** The signed-in viewer's user id, or null. Never trusts an id or role sent by the browser. */
export async function currentUserId(): Promise<string | null> {
  const token = await readToken();
  if (!token) return null;
  const { ctx } = await getRuntime();
  const session = await sessionUser(ctx, token);
  if (!session) return null;
  if (!session.registered && !demoModeEnabled()) return null;
  return session.userId;
}

export async function openSession(userId: string): Promise<void> {
  const { ctx } = await getRuntime();
  const token = await startSession(ctx, userId);
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
}

export async function closeSession(): Promise<void> {
  const token = await readToken();
  if (token) {
    const { ctx } = await getRuntime();
    await endSession(ctx, token);
  }
  (await cookies()).delete(SESSION_COOKIE);
}
