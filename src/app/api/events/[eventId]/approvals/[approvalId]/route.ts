import type { NextResponse } from 'next/server';
import { currentUserId } from '@/lib/session';
import { errorResponse, jsonError, jsonOk, readJson } from '@/lib/http';
import { getRuntime } from '@/lib/runtime';
import { ApprovalDecisionBody } from '@/lib/validation/api';
import { decideApproval } from '@/services/approvals';

export async function POST(
  request: Request,
  context: { params: Promise<{ eventId: string; approvalId: string }> },
): Promise<NextResponse> {
  const userId = await currentUserId();
  if (!userId) {
    return jsonError('UNAUTHENTICATED', 'Choose a demo account to continue.', 401);
  }
  const { eventId, approvalId } = await context.params;
  try {
    const parsed = ApprovalDecisionBody.safeParse(await readJson(request));
    if (!parsed.success) {
      return jsonError('VALIDATION_FAILED', 'That decision is not valid.', 422);
    }
    const { ctx } = await getRuntime();
    const approval = await decideApproval(ctx, {
      eventId,
      actorUserId: userId,
      approvalId,
      decision: parsed.data.decision,
      reason: parsed.data.reason,
      expectedVersion: parsed.data.expectedVersion,
    });
    return jsonOk(approval);
  } catch (error: unknown) {
    return errorResponse(error, 'approvals.decide');
  }
}
