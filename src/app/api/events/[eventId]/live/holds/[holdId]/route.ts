import type { NextResponse } from 'next/server';
import { currentUserId } from '@/lib/session';
import { errorResponse, jsonError, jsonOk, readJson } from '@/lib/http';
import { getRuntime } from '@/lib/runtime';
import { ReleaseHoldBody } from '@/lib/validation/live';
import { releaseSafetyHold } from '@/services/live';

/** Releases a hold. Only a different organiser may do it, and this is the only way visibility is restored. */
export async function POST(request: Request, context: { params: Promise<{ eventId: string; holdId: string }> }): Promise<NextResponse> {
  const userId = await currentUserId();
  if (!userId) return jsonError('UNAUTHENTICATED', 'Sign in to continue.', 401);
  const { eventId, holdId } = await context.params;
  try {
    const parsed = ReleaseHoldBody.safeParse(await readJson(request));
    if (!parsed.success) return jsonError('VALIDATION_FAILED', 'Give the reason for releasing the hold.', 422);
    const { ctx } = await getRuntime();
    const hold = await releaseSafetyHold(ctx, { eventId, actorUserId: userId, holdId, reason: parsed.data.reason });
    return jsonOk({ id: hold.id, status: hold.status });
  } catch (error: unknown) {
    return errorResponse(error, 'live.hold_release');
  }
}

export const dynamic = 'force-dynamic';
