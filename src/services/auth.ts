import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { z } from 'zod';
import { DomainError } from '../domain/errors';
import { DEMO_EVENT_ID } from '../store/seed';
import { audit, type ServiceContext } from './context';

/**
 * Accounts and sessions.
 *
 * - Passwords are stored as scrypt hashes with a per-account salt, compared in constant time.
 * - The session cookie carries a random 256-bit token. Only its SHA-256 is stored, so a copy of the
 *   store cannot be replayed as a session.
 * - Sign-in gives one answer for "no such handle" and "wrong password", and does the same work for
 *   both, so it cannot be used to find out who has an account.
 */

const scrypt = promisify(scryptCb) as (password: string, salt: Buffer, keylen: number) => Promise<Buffer>;
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
export const SESSION_MAX_AGE_SECONDS = SESSION_TTL_MS / 1000;

export const RegisterSchema = z.object({
  handle: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9_]{3,24}$/),
  displayName: z.string().trim().min(1).max(80),
  password: z.string().min(10).max(200),
});

export const SignInSchema = z.object({
  handle: z.string().trim().toLowerCase().max(24),
  password: z.string().max(200),
});

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString('base64url')}$${key.toString('base64url')}`;
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, salt, hash] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64url');
  const actual = await scrypt(password, Buffer.from(salt, 'base64url'), expected.length);
  return timingSafeEqual(actual, expected);
}

/** A hash of nothing in particular, verified when the handle is unknown so both paths take the same time. */
let decoy: Promise<string> | null = null;

export async function startSession(ctx: ServiceContext, userId: string): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  const now = ctx.now();
  await ctx.store.docPut('authSessions', { id: sha256(token), userId, createdAt: now, expiresAt: now + SESSION_TTL_MS });
  return token;
}

export async function sessionUser(ctx: ServiceContext, token: string): Promise<{ userId: string; registered: boolean } | null> {
  const id = sha256(token);
  const session = await ctx.store.docGet('authSessions', id);
  if (!session) return null;
  if (session.expiresAt <= ctx.now()) {
    await ctx.store.docDelete('authSessions', id);
    return null;
  }
  const accounts = await ctx.store.docList('accounts', { userId: session.userId });
  return { userId: session.userId, registered: accounts.length > 0 };
}

export async function endSession(ctx: ServiceContext, token: string): Promise<void> {
  await ctx.store.docDelete('authSessions', sha256(token));
}

export async function register(ctx: ServiceContext, input: z.infer<typeof RegisterSchema>): Promise<string> {
  const passwordHash = await hashPassword(input.password);
  const userId = `u-${randomBytes(6).toString('hex')}`;
  const created = await ctx.store.docPutIfAbsent('accounts', { id: input.handle, userId, passwordHash, createdAt: ctx.now() });
  if (!created) throw new DomainError('VALIDATION_FAILED', 'That handle is taken. Choose another.');
  // New people start private: not discoverable until they choose to be.
  await ctx.store.insertUser({ id: userId, displayName: input.displayName, interests: [], discoverable: false, accessibilityRequired: false });
  await ctx.store.insertMembership({ id: `m-${userId}`, eventId: DEMO_EVENT_ID, userId, role: 'ATTENDEE', skills: [], availability: 'AVAILABLE', zone: null });
  await audit(ctx, DEMO_EVENT_ID, userId, 'account.register', 'user', userId, 'Created an account and joined as an attendee.');
  return userId;
}

export async function signIn(ctx: ServiceContext, input: z.infer<typeof SignInSchema>): Promise<string> {
  const account = await ctx.store.docGet('accounts', input.handle);
  decoy ??= hashPassword(randomBytes(16).toString('hex'));
  const ok = await verifyPassword(input.password, account?.passwordHash ?? (await decoy));
  if (!account || !ok) throw new DomainError('FORBIDDEN', 'That handle and password do not match.');
  return account.userId;
}

/** Signs the person out everywhere. Used by erasure. */
export async function endAllSessions(ctx: ServiceContext, userId: string): Promise<void> {
  for (const s of await ctx.store.docList('authSessions', { userId })) await ctx.store.docDelete('authSessions', s.id);
}
