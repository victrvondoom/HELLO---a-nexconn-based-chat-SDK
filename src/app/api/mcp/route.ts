import { NextResponse } from 'next/server';
import { DomainError } from '@/domain/errors';
import { clientKey, errorResponse } from '@/lib/http';
import { getRuntime } from '@/lib/runtime';
import { FixedWindowRateLimiter } from '@/lib/rate-limit';
import { handleMcp } from '@/services/mcp';
import { resolveToken } from '@/services/tokens';

/**
 * MCP endpoint. Authentication is a personal access token in the Authorization header; the session
 * cookie is deliberately ignored here, so a web page can never drive tools with someone's browser session.
 */
const perToken = new FixedWindowRateLimiter(120, 60_000);
const perAddress = new FixedWindowRateLimiter(60, 60_000);
const MAX_BODY = 64 * 1024;

const unauthorised = () =>
  NextResponse.json({ jsonrpc: '2.0', id: null, error: { code: -32001, message: 'A valid access token is required.' } }, { status: 401, headers: { 'WWW-Authenticate': 'Bearer realm="hello-mcp"' } });

export async function POST(request: Request): Promise<Response> {
  try {
    const { ctx } = await getRuntime();
    const secret = /^Bearer (\S{1,120})$/.exec(request.headers.get('authorization') ?? '')?.[1];
    // Wrong tokens are counted per address, so the token space cannot be searched.
    const token = secret ? await resolveToken(ctx, secret) : null;
    if (!token) {
      perAddress.consume(`mcp-miss:${clientKey(request)}`, ctx.now());
      return unauthorised();
    }
    perToken.consume(`mcp:${token.id}`, ctx.now());
    const raw = await request.text();
    if (raw.length > MAX_BODY) throw new DomainError('VALIDATION_FAILED', 'Request too large.');
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      return NextResponse.json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error.' } }, { status: 400 });
    }
    const reply = await handleMcp(ctx, token, body);
    return reply ? NextResponse.json(reply) : new NextResponse(null, { status: 202 });
  } catch (error: unknown) {
    return errorResponse(error, 'mcp');
  }
}

export function GET(): Response {
  return new NextResponse(null, { status: 405, headers: { Allow: 'POST' } });
}
