import type { NextResponse } from 'next/server';
import { currentUserId } from '@/lib/session';
import { errorResponse, jsonError, jsonOk, readJson } from '@/lib/http';
import { getRuntime } from '@/lib/runtime';
import { SignalReviewBody } from '@/lib/validation/api';
import { reviewPattern } from '@/services/signals';

export async function POST(
  request: Request,
  context: { params: Promise<{ eventId: string; patternId: string }> },
): Promise<NextResponse> {
  const userId = await currentUserId();
  if (!userId) {
    return jsonError('UNAUTHENTICATED', 'Choose a demo account to continue.', 401);
  }
  const { eventId, patternId } = await context.params;
  try {
    const parsed = SignalReviewBody.safeParse(await readJson(request));
    if (!parsed.success) {
      return jsonError('VALIDATION_FAILED', 'Choose accept or reject.', 422);
    }
    const { ctx } = await getRuntime();
    const pattern = await reviewPattern(ctx, eventId, userId, patternId, parsed.data.decision);
    return jsonOk(pattern);
  } catch (error: unknown) {
    return errorResponse(error, 'signals.review');
  }
}
