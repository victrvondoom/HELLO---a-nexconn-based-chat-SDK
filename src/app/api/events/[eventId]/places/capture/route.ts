import type { NextResponse } from 'next/server';
import { currentUserId } from '@/lib/session';
import { errorResponse, jsonError, jsonOk, readJson } from '@/lib/http';
import { getRuntime } from '@/lib/runtime';
import { CaptureBody } from '@/lib/validation/places';
import { previewCapture } from '@/services/place-capture';

/** Looks for places in pasted text, a link or an import file. Nothing is saved by this request. */
export async function POST(request: Request, context: { params: Promise<{ eventId: string }> }): Promise<NextResponse> {
  const userId = await currentUserId();
  if (!userId) return jsonError('UNAUTHENTICATED', 'Sign in to continue.', 401);
  const { eventId } = await context.params;
  try {
    const parsed = CaptureBody.safeParse(await readJson(request));
    if (!parsed.success) return jsonError('VALIDATION_FAILED', 'Check what you pasted or chose, then try again.', 422);
    const { ctx } = await getRuntime();
    const input = parsed.data.kind === 'LINK' ? { ...parsed.data, name: parsed.data.name ?? null } : parsed.data;
    return jsonOk(await previewCapture(ctx, eventId, userId, input));
  } catch (error: unknown) {
    return errorResponse(error, 'places.capture');
  }
}

export const dynamic = 'force-dynamic';
