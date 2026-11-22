import type { NextResponse } from 'next/server';
import { currentUserId } from '@/lib/session';
import { errorResponse, jsonError, jsonOk } from '@/lib/http';
import { getRuntime } from '@/lib/runtime';
import { liveFeed } from '@/services/live';

/** The live view for the signed-in person. Staff also receive the moderation queue and the holds. */
export async function GET(_request: Request, context: { params: Promise<{ eventId: string }> }): Promise<NextResponse> {
  const userId = await currentUserId();
  if (!userId) return jsonError('UNAUTHENTICATED', 'Sign in to continue.', 401);
  const { eventId } = await context.params;
  try {
    const { ctx } = await getRuntime();
    return jsonOk(await liveFeed(ctx, eventId, userId));
  } catch (error: unknown) {
    return errorResponse(error, 'live.feed');
  }
}

export const dynamic = 'force-dynamic';
