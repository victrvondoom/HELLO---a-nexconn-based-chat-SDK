import { cookies } from 'next/headers';
import type { NextResponse } from 'next/server';
import { DEMO_SESSION_COOKIE, demoModeEnabled } from '@/lib/session';
import { DemoSessionBody } from '@/lib/validation/api';
import { errorResponse, jsonError, jsonOk, readJson } from '@/lib/http';
import { getRuntime } from '@/lib/runtime';

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
    const { store } = await getRuntime();
    const user = await store.getUser(parsed.data.userId);
    if (!user) {
      return jsonError('NOT_FOUND', 'That demo account does not exist.', 404);
    }
    const jar = await cookies();
    jar.set(DEMO_SESSION_COOKIE, user.id, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 60 * 60 * 8,
    });
    return jsonOk({ userId: user.id, displayName: user.displayName });
  } catch (error: unknown) {
    return errorResponse(error, 'demo.session');
  }
}

export async function DELETE(): Promise<NextResponse> {
  const jar = await cookies();
  jar.delete(DEMO_SESSION_COOKIE);
  return jsonOk({ signedOut: true });
}
