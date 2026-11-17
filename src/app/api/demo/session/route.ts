import type { NextResponse } from 'next/server';
import { closeSession, demoModeEnabled, openSession } from '@/lib/session';
import { DemoSessionBody } from '@/lib/validation/api';
import { clientKey, errorResponse, jsonError, jsonOk, readJson } from '@/lib/http';
import { FixedWindowRateLimiter } from '@/lib/rate-limit';
import { getRuntime } from '@/lib/runtime';

const limiter = new FixedWindowRateLimiter(120, 60_000);

/** Starts a DEMO session as one of the seeded demo accounts. Disabled in production unless explicitly enabled. */
export async function POST(request: Request): Promise<NextResponse> {
  if (!demoModeEnabled()) {
    return jsonError('DISABLED', 'Demo sign-in is disabled in this deployment.', 404);
  }
  try {
    const parsed = DemoSessionBody.safeParse(await readJson(request));
    if (!parsed.success) {
      return jsonError('VALIDATION_FAILED', 'Choose a demo account.', 422);
    }
    const { store, ctx } = await getRuntime();
    limiter.consume(`demo:${clientKey(request)}`, ctx.now());
    const user = await store.getUser(parsed.data.userId);
    if (!user) {
      return jsonError('NOT_FOUND', 'That demo account does not exist.', 404);
    }
    await openSession(user.id);
    return jsonOk({ userId: user.id, displayName: user.displayName });
  } catch (error: unknown) {
    return errorResponse(error, 'demo.session');
  }
}

export async function DELETE(): Promise<NextResponse> {
  await closeSession();
  return jsonOk({ signedOut: true });
}
