import type { NextResponse } from 'next/server';
import { currentUserId } from '@/lib/session';
import { errorResponse, jsonError, jsonOk, readJson } from '@/lib/http';
import { getRuntime } from '@/lib/runtime';
import { CollectionBody } from '@/lib/validation/places';
import { createCollection } from '@/services/places';

/** Creates one of the person's own collections for this event. */
export async function POST(request: Request, context: { params: Promise<{ eventId: string }> }): Promise<NextResponse> {
  const userId = await currentUserId();
  if (!userId) return jsonError('UNAUTHENTICATED', 'Sign in to continue.', 401);
  const { eventId } = await context.params;
  try {
    const parsed = CollectionBody.safeParse(await readJson(request));
    if (!parsed.success) return jsonError('VALIDATION_FAILED', 'Give the collection a name.', 422);
    const { ctx } = await getRuntime();
    return jsonOk(await createCollection(ctx, eventId, userId, parsed.data.name), 201);
  } catch (error: unknown) {
    return errorResponse(error, 'places.collection');
  }
}

export const dynamic = 'force-dynamic';
