import type { NextResponse } from 'next/server';
import { currentUserId } from '@/lib/session';
import { errorResponse, jsonError, jsonOk, readJson } from '@/lib/http';
import { getRuntime } from '@/lib/runtime';
import { PlaceHoldBody } from '@/lib/validation/live';
import { placeSafetyHold } from '@/services/live';

/** Places a scoped, time-bounded hold on the public live view. Private messages are never affected. */
export async function POST(request: Request, context: { params: Promise<{ eventId: string }> }): Promise<NextResponse> {
  const userId = await currentUserId();
  if (!userId) return jsonError('UNAUTHENTICATED', 'Sign in to continue.', 401);
  const { eventId } = await context.params;
  try {
    const parsed = PlaceHoldBody.safeParse(await readJson(request));
    if (!parsed.success) return jsonError('VALIDATION_FAILED', 'That hold is not valid. Give a scope, a reason and a time limit.', 422);
    const { ctx } = await getRuntime();
    const { hold, created } = await placeSafetyHold(ctx, { eventId, actorUserId: userId, ...parsed.data });
    return jsonOk({ id: hold.id, created }, created ? 201 : 200);
  } catch (error: unknown) {
    return errorResponse(error, 'live.hold');
  }
}

export const dynamic = 'force-dynamic';
