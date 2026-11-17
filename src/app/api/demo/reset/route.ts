import type { NextResponse } from 'next/server';
import { currentUserId, demoModeEnabled } from '@/lib/session';
import { errorResponse, jsonError, jsonOk } from '@/lib/http';
import { getRuntime, resetRuntime } from '@/lib/runtime';
import { requireCapability } from '@/services/context';
import { DEMO_EVENT_ID } from '@/store/seed';

/**
 * Restores the seeded demo event to its starting state. It discards everything, including accounts
 * people registered, so it exists only in demo mode and only an organiser of the demo event may run it.
 */
export async function POST(): Promise<NextResponse> {
  if (!demoModeEnabled()) {
    return jsonError('DISABLED', 'Demo reset is disabled in this deployment.', 404);
  }
  const userId = await currentUserId();
  if (!userId) return jsonError('UNAUTHENTICATED', 'Sign in to continue.', 401);
  try {
    const { ctx } = await getRuntime();
    await requireCapability(ctx, DEMO_EVENT_ID, userId, 'member.manage');
    await resetRuntime();
    return jsonOk({ reset: true });
  } catch (error: unknown) {
    return errorResponse(error, 'demo.reset');
  }
}
