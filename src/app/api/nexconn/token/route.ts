import type { NextResponse } from 'next/server';
import { currentUserId } from '@/lib/session';
import { errorResponse, jsonError, jsonOk } from '@/lib/http';
import { getRuntime } from '@/lib/runtime';
import { nexconnUserId, tokenIssuerFromEnv } from '@/integrations/nexconn/token';

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
    const { store } = await getRuntime();
    const user = await store.getUser(userId);
    const issued = await state.issuer.issue({ userId: nexconnUserId(userId), displayName: user?.displayName ?? 'HELLO user' });
    return jsonOk({ appKey: state.appKey, nexconnUserId: nexconnUserId(userId), token: issued.token, expiresAt: issued.expiresAt });
  } catch (error: unknown) {
    return errorResponse(error, 'nexconn.token');
  }
}

export const dynamic = 'force-dynamic';
