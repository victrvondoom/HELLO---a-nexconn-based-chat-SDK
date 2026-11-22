import type { NextResponse } from 'next/server';
import { currentUserId } from '@/lib/session';
import { errorResponse, jsonError, jsonOk, readJson } from '@/lib/http';
import { getRuntime } from '@/lib/runtime';
import { PlaceActionBody } from '@/lib/validation/places';
import { deletePlace, updatePlace } from '@/services/places';

/** One of the person's places: update it (with the version they read), or delete it. */
export async function POST(request: Request, context: { params: Promise<{ eventId: string; placeId: string }> }): Promise<NextResponse> {
  const userId = await currentUserId();
  if (!userId) return jsonError('UNAUTHENTICATED', 'Sign in to continue.', 401);
  const { eventId, placeId } = await context.params;
  try {
    const parsed = PlaceActionBody.safeParse(await readJson(request));
    if (!parsed.success) return jsonError('VALIDATION_FAILED', 'That change is not valid.', 422);
    const { ctx } = await getRuntime();
    if (parsed.data.action === 'delete') {
      await deletePlace(ctx, { eventId, userId, placeId });
      return jsonOk({ deleted: true });
    }
    const place = await updatePlace(ctx, { eventId, userId, placeId, expectedVersion: parsed.data.expectedVersion, patch: parsed.data.patch });
    return jsonOk(place);
  } catch (error: unknown) {
    return errorResponse(error, 'places.change');
  }
}

export const dynamic = 'force-dynamic';
