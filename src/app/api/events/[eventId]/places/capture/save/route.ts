import type { NextResponse } from 'next/server';
import { currentUserId } from '@/lib/session';
import { errorResponse, jsonError, jsonOk, readJson } from '@/lib/http';
import { getRuntime } from '@/lib/runtime';
import { SaveBody } from '@/lib/validation/places';
import { savePlaces } from '@/services/place-capture';

/** Saves only the candidates the person selected, from the source they came from. */
export async function POST(request: Request, context: { params: Promise<{ eventId: string }> }): Promise<NextResponse> {
  const userId = await currentUserId();
  if (!userId) return jsonError('UNAUTHENTICATED', 'Sign in to continue.', 401);
  const { eventId } = await context.params;
  try {
    const parsed = SaveBody.safeParse(await readJson(request));
    if (!parsed.success) return jsonError('VALIDATION_FAILED', 'Choose at least one place to save, and check the details.', 422);
    const { ctx } = await getRuntime();
    const input = parsed.data;
    const result = await savePlaces(ctx, eventId, userId, input);
    return jsonOk({ saved: result.saved, skipped: result.skipped, importId: result.importId });
  } catch (error: unknown) {
    return errorResponse(error, 'places.save');
  }
}

export const dynamic = 'force-dynamic';
