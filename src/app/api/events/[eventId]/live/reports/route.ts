import type { NextResponse } from 'next/server';
import { currentUserId } from '@/lib/session';
import { errorResponse, jsonError, jsonOk, readJson } from '@/lib/http';
import { getRuntime } from '@/lib/runtime';
import { SubmitLiveReportBody } from '@/lib/validation/live';
import { submitLiveReport } from '@/services/live';

/** Sends a report about a place on the venue map. The reporter's identity is recorded but never shown to attendees. */
export async function POST(request: Request, context: { params: Promise<{ eventId: string }> }): Promise<NextResponse> {
  const userId = await currentUserId();
  if (!userId) return jsonError('UNAUTHENTICATED', 'Sign in to continue.', 401);
  const { eventId } = await context.params;
  try {
    const parsed = SubmitLiveReportBody.safeParse(await readJson(request));
    if (!parsed.success) return jsonError('VALIDATION_FAILED', 'That report is not valid. Choose a place and a kind of report.', 422);
    const { ctx } = await getRuntime();
    const result = await submitLiveReport(ctx, { eventId, userId, ...parsed.data });
    return jsonOk(result, 201);
  } catch (error: unknown) {
    return errorResponse(error, 'live.report');
  }
}

export const dynamic = 'force-dynamic';
