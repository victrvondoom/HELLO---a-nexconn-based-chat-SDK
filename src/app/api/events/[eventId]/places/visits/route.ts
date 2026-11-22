import type { NextResponse } from 'next/server';
import { currentUserId } from '@/lib/session';
import { errorResponse, jsonError, jsonOk, readJson } from '@/lib/http';
import { getRuntime } from '@/lib/runtime';
import { VisitCheckInBody } from '@/lib/validation/places';
import { checkIn } from '@/services/place-visits';

/** Records that the person is at a venue place now. Their earlier visit there is ended. */
export async function POST(request: Request, context: { params: Promise<{ eventId: string }> }): Promise<NextResponse> {
  const userId = await currentUserId();
  if (!userId) return jsonError('UNAUTHENTICATED', 'Sign in to continue.', 401);
  const { eventId } = await context.params;
  try {
    const parsed = VisitCheckInBody.safeParse(await readJson(request));
    if (!parsed.success) return jsonError('VALIDATION_FAILED', 'Choose a place on the venue map to check in to.', 422);
    const { ctx } = await getRuntime();
    const visit = await checkIn(ctx, { eventId, userId, spaceId: parsed.data.spaceId, placeId: parsed.data.placeId ?? null });
    return jsonOk(visit, 201);
  } catch (error: unknown) {
    return errorResponse(error, 'places.check_in');
  }
}

export const dynamic = 'force-dynamic';
