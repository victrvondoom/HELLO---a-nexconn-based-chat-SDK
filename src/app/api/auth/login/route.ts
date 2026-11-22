import type { NextResponse } from 'next/server';
import { clientKey, errorResponse, jsonOk, parseBody } from '@/lib/http';
import { getRuntime } from '@/lib/runtime';
import { FixedWindowRateLimiter } from '@/lib/rate-limit';
import { openSession } from '@/lib/session';
import { signIn, SignInSchema } from '@/services/auth';
import { DEMO_EVENT_ID } from '@/store/seed';

/** Guessing is limited per handle and per address, so neither one account nor one network can be worked through. */
const perHandle = new FixedWindowRateLimiter(8, 10 * 60_000);
const perAddress = new FixedWindowRateLimiter(40, 10 * 60_000);

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const { ctx } = await getRuntime();
    const input = await parseBody(request, SignInSchema, 'Enter your handle and password.');
    perAddress.consume(`login:${clientKey(request)}`, ctx.now());
    perHandle.consume(`login:${input.handle}`, ctx.now());
    const userId = await signIn(ctx, input);
    await openSession(userId);
    return jsonOk({ userId, eventId: DEMO_EVENT_ID });
  } catch (error: unknown) {
    return errorResponse(error, 'auth.login');
  }
}

export const dynamic = 'force-dynamic';
