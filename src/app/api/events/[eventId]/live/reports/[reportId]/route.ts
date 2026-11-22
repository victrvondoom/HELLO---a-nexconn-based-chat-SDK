import type { NextResponse } from 'next/server';
import { currentUserId } from '@/lib/session';
import { errorResponse, jsonError, jsonOk, readJson } from '@/lib/http';
import { getRuntime } from '@/lib/runtime';
import { LiveReportActionBody } from '@/lib/validation/live';
import { dismissLiveReport, promoteLiveReport } from '@/services/live';

/** A staff decision on one report: promote it to an incident, or dismiss it with a reason. */
export async function POST(request: Request, context: { params: Promise<{ eventId: string; reportId: string }> }): Promise<NextResponse> {
  const userId = await currentUserId();
  if (!userId) return jsonError('UNAUTHENTICATED', 'Sign in to continue.', 401);
  const { eventId, reportId } = await context.params;
  try {
    const parsed = LiveReportActionBody.safeParse(await readJson(request));
    if (!parsed.success) return jsonError('VALIDATION_FAILED', 'That decision is not valid.', 422);
    const { ctx } = await getRuntime();
    if (parsed.data.action === 'promote') {
      const result = await promoteLiveReport(ctx, { eventId, actorUserId: userId, reportId, category: parsed.data.category });
      return jsonOk({ incidentId: result.incident.id, attached: result.attached, alreadyPromoted: result.alreadyPromoted });
    }
    const report = await dismissLiveReport(ctx, { eventId, actorUserId: userId, reportId, reason: parsed.data.reason });
    return jsonOk({ id: report.id, status: report.status });
  } catch (error: unknown) {
    return errorResponse(error, 'live.report_action');
  }
}

export const dynamic = 'force-dynamic';
