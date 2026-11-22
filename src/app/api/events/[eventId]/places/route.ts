import type { NextResponse } from 'next/server';
import { currentUserId } from '@/lib/session';
import { errorResponse, jsonError, jsonOk, readJson } from '@/lib/http';
import { getRuntime } from '@/lib/runtime';
import { PlaceBody } from '@/lib/validation/places';
import { createPlace, listMyPlaces } from '@/services/places';

/** The signed-in person's own places for this event. Nobody else's places are ever returned. */
export async function GET(_request: Request, context: { params: Promise<{ eventId: string }> }): Promise<NextResponse> {
  const userId = await currentUserId();
  if (!userId) return jsonError('UNAUTHENTICATED', 'Sign in to continue.', 401);
  const { eventId } = await context.params;
  try {
    const { ctx } = await getRuntime();
    return jsonOk(await listMyPlaces(ctx, eventId, userId));
  } catch (error: unknown) {
    return errorResponse(error, 'places.list');
  }
}

export async function POST(request: Request, context: { params: Promise<{ eventId: string }> }): Promise<NextResponse> {
  const userId = await currentUserId();
  if (!userId) return jsonError('UNAUTHENTICATED', 'Sign in to continue.', 401);
  const { eventId } = await context.params;
  try {
    const parsed = PlaceBody.safeParse(await readJson(request));
    if (!parsed.success) return jsonError('VALIDATION_FAILED', 'Check the place: a name and a category are needed.', 422);
    const { ctx } = await getRuntime();
    return jsonOk(await createPlace(ctx, eventId, userId, parsed.data), 201);
  } catch (error: unknown) {
    return errorResponse(error, 'places.create');
  }
}

export const dynamic = 'force-dynamic';
