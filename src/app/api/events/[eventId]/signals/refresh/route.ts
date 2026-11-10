import type { NextResponse } from 'next/server';
import { currentUserId } from '@/lib/session';
import { errorResponse, jsonError, jsonOk } from '@/lib/http';
import { getRuntime } from '@/lib/runtime';
import { refreshSignals } from '@/services/signals';

export async function POST(
  _request: Request,
  context: { params: Promise<{ eventId: string }> },
): Promise<NextResponse> {
  const userId = await currentUserId();
  if (!userId) {
    return jsonError('UNAUTHENTICATED', 'Choose a demo account to continue.', 401);
  }
  const { eventId } = await context.params;
  try {
    const { ctx } = await getRuntime();
    const patterns = await refreshSignals(ctx, eventId, userId);
    return jsonOk(patterns);
  } catch (error: unknown) {
    return errorResponse(error, 'signals.refresh');
  }
}
