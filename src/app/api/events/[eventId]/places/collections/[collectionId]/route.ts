import type { NextResponse } from 'next/server';
import { currentUserId } from '@/lib/session';
import { errorResponse, jsonError, jsonOk } from '@/lib/http';
import { getRuntime } from '@/lib/runtime';
import { deleteCollection } from '@/services/places';

/** Deletes one of the person's collections. Its places are kept; only the grouping goes. */
export async function POST(_request: Request, context: { params: Promise<{ eventId: string; collectionId: string }> }): Promise<NextResponse> {
  const userId = await currentUserId();
  if (!userId) return jsonError('UNAUTHENTICATED', 'Sign in to continue.', 401);
  const { eventId, collectionId } = await context.params;
  try {
    const { ctx } = await getRuntime();
    await deleteCollection(ctx, { eventId, userId, collectionId });
    return jsonOk({ deleted: true });
  } catch (error: unknown) {
    return errorResponse(error, 'places.collection_delete');
  }
}

export const dynamic = 'force-dynamic';
