import type { NextResponse } from 'next/server';
import { currentUserId } from '@/lib/session';
import { errorResponse, jsonError, jsonOk } from '@/lib/http';
import { getRuntime } from '@/lib/runtime';
import { NexconnApiError, nexconnUserId, tokenIssuerFromEnv } from '@/integrations/nexconn/token';
import { FixedWindowRateLimiter } from '@/lib/rate-limit';

// A token is needed once per sign-in; 10 a minute per person is plenty and keeps the App Key's quota safe.
const limiter = new FixedWindowRateLimiter(10, 60_000);

/**
 * Issues a Nexconn user token for the signed-in person. The App Secret never leaves the server: the
 * response carries the public App Key, the Nexconn user id and the token, nothing else.
 */
export async function POST(): Promise<NextResponse> {
  try {
    const userId = await currentUserId();
    if (!userId) return jsonError('UNAUTHENTICATED', 'Sign in first.', 401);
    const state = tokenIssuerFromEnv();
    if (!state.ready) return jsonError(state.reason, state.message, 503);
    const { store, ctx } = await getRuntime();
    limiter.consume(`nexconn-token:${userId}`, ctx.now());
    const user = await store.getUser(userId);
    const issued = await state.issuer.issue({ userId: nexconnUserId(userId), displayName: user?.displayName ?? 'HELLO user' });
    return jsonOk({ appKey: state.appKey, area: state.area, nexconnUserId: nexconnUserId(userId), token: issued.token, expiresAt: issued.expiresAt });
  } catch (error: unknown) {
    // Nexconn's own failure: say what kind, never echo credentials or the upstream body.
    if (error instanceof NexconnApiError) return jsonError(error.status === 401 ? 'NEXCONN_AUTH_FAILED' : 'NEXCONN_UNAVAILABLE', error.message, 502);
    return errorResponse(error, 'nexconn.token');
  }
}

export const dynamic = 'force-dynamic';
