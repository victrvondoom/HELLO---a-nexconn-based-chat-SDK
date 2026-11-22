import type { NextResponse } from 'next/server';
import { currentUserId } from '@/lib/session';
import { errorResponse, jsonError, jsonOk } from '@/lib/http';
import { getRuntime } from '@/lib/runtime';
import { MAX_PHOTO_BYTES } from '@/domain/places/capture';
import { previewPhoto } from '@/services/place-capture';

/**
 * Reads only the location a JPEG carries. The photo is read into memory for this request, its metadata is parsed,
 * and nothing is written. The person decides afterwards whether to save the location.
 */
export async function POST(request: Request, context: { params: Promise<{ eventId: string }> }): Promise<NextResponse> {
  const userId = await currentUserId();
  if (!userId) return jsonError('UNAUTHENTICATED', 'Sign in to continue.', 401);
  const { eventId } = await context.params;
  try {
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return jsonError('VALIDATION_FAILED', 'Choose a photo to read.', 422);
    }
    const file = form.get('photo');
    if (!(file instanceof File)) return jsonError('VALIDATION_FAILED', 'Choose a photo to read.', 422);
    if (file.type !== 'image/jpeg') return jsonError('VALIDATION_FAILED', 'Only JPEG photos carry the location data HELLO can read.', 422);
    if (file.size > MAX_PHOTO_BYTES) return jsonError('VALIDATION_FAILED', 'That photo is too large. Choose a smaller one.', 422);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const { ctx } = await getRuntime();
    return jsonOk(await previewPhoto(ctx, eventId, userId, bytes));
  } catch (error: unknown) {
    return errorResponse(error, 'places.capture_photo');
  }
}

export const dynamic = 'force-dynamic';
