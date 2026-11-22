import type { NextResponse } from 'next/server';
import { clientKey, errorResponse, jsonOk, parseBody } from '@/lib/http';
import { getRuntime } from '@/lib/runtime';
import { FixedWindowRateLimiter } from '@/lib/rate-limit';
import { openSession } from '@/lib/session';
import { register, RegisterSchema } from '@/services/auth';
import { DEMO_EVENT_ID } from '@/store/seed';

/** Ten new accounts an hour from one address: enough for a shared network, too few to fill the event with fakes. */
const limiter = new FixedWindowRateLimiter(10, 60 * 60_000);

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const { ctx } = await getRuntime();
    limiter.consume(`register:${clientKey(request)}`, ctx.now());
    const input = await parseBody(request, RegisterSchema, 'Handle: 3 to 24 letters, digits or underscores. Password: at least 10 characters.');
    const userId = await register(ctx, input);
    await openSession(userId);
    return jsonOk({ userId, eventId: DEMO_EVENT_ID }, 201);
  } catch (error: unknown) {
    return errorResponse(error, 'auth.register');
  }
}

export const dynamic = 'force-dynamic';
