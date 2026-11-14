import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { DomainError } from '../domain/errors';
import type { ApiToken } from '../domain/product';
import { audit, requireCapability, type ServiceContext } from './context';
import { ID } from './feed';

/**
 * Personal access tokens, used by MCP clients (src/services/mcp.ts).
 *
 * A token acts as the person who made it, in one event, and can never do more than they can. It is
 * shown once; only its SHA-256 is stored. READ tokens cannot change anything.
 */

export const TOKEN_PREFIX = 'hello_pat_';
export const TokenSchema = z.object({ name: z.string().trim().min(1).max(60), scope: z.enum(['READ', 'WRITE']), eventId: z.string().regex(/^evt-[a-z0-9-]{1,60}$/) });

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
const publicView = (t: ApiToken) => ({ id: t.id, name: t.name, scope: t.scope, createdAt: t.createdAt, lastUsedAt: t.lastUsedAt });

export async function createToken(ctx: ServiceContext, userId: string, input: z.infer<typeof TokenSchema>) {
  await requireCapability(ctx, input.eventId, userId, 'event.read');
  if ((await ctx.store.docList('apiTokens', { userId })).length >= 10) throw new DomainError('VALIDATION_FAILED', 'You can have up to 10 access tokens. Revoke one first.');
  const secret = `${TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`;
  const token: ApiToken = { id: ctx.newId('tok'), userId, eventId: input.eventId, name: input.name, hash: sha256(secret), scope: input.scope, createdAt: ctx.now(), lastUsedAt: null };
  await ctx.store.docPut('apiTokens', token);
  await audit(ctx, input.eventId, userId, 'token.create', 'token', token.id, `Created a ${input.scope === 'READ' ? 'read-only' : 'read and write'} access token.`);
  return { ...publicView(token), secret };
}

export async function listTokens(ctx: ServiceContext, userId: string) {
  return (await ctx.store.docList('apiTokens', { userId })).sort((a, b) => b.createdAt - a.createdAt).map(publicView);
}

export async function revokeToken(ctx: ServiceContext, userId: string, tokenId: string): Promise<void> {
  const token = ID.test(tokenId) ? await ctx.store.docGet('apiTokens', tokenId) : null;
  // Someone else's token id looks exactly like one that does not exist.
  if (!token || token.userId !== userId) throw new DomainError('NOT_FOUND', 'That token does not exist.');
  await ctx.store.docDelete('apiTokens', token.id);
  await audit(ctx, token.eventId, userId, 'token.revoke', 'token', token.id, 'Revoked an access token.');
}

export async function resolveToken(ctx: ServiceContext, secret: string): Promise<ApiToken | null> {
  if (!secret.startsWith(TOKEN_PREFIX) || secret.length > 100) return null;
  const [token] = await ctx.store.docList('apiTokens', { hash: sha256(secret) });
  if (!token) return null;
  // The person must still belong to the event the token was made for.
  if (!(await ctx.store.findMembership(token.eventId, token.userId))) return null;
  if (ctx.now() - (token.lastUsedAt ?? 0) > 60_000) await ctx.store.docMutate('apiTokens', token.id, (t) => ({ ...t, lastUsedAt: ctx.now() }));
  return token;
}
