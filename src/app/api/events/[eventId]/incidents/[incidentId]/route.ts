import type { NextResponse } from 'next/server';
import { currentUserId } from '@/lib/session';
import { errorResponse, jsonError, jsonOk, readJson } from '@/lib/http';
import { getRuntime } from '@/lib/runtime';
import { IncidentActionBody } from '@/lib/validation/api';
import { claimIncident, transitionIncident } from '@/services/incidents';

export async function POST(
  request: Request,
  context: { params: Promise<{ eventId: string; incidentId: string }> },
): Promise<NextResponse> {
  const userId = await currentUserId();
  if (!userId) {
    return jsonError('UNAUTHENTICATED', 'Choose a demo account to continue.', 401);
  }
  const { eventId, incidentId } = await context.params;
  try {
    const parsed = IncidentActionBody.safeParse(await readJson(request));
    if (!parsed.success) {
      return jsonError('VALIDATION_FAILED', 'That action is not valid.', 422);
    }
    const { ctx } = await getRuntime();
    const body = parsed.data;
    if (body.action === 'claim') {
      const incident = await claimIncident(ctx, eventId, userId, incidentId, body.expectedVersion);
      return jsonOk(incident);
    }
    const incident = await transitionIncident(ctx, {
      eventId,
      actorUserId: userId,
      incidentId,
      to: body.to,
      expectedVersion: body.expectedVersion,
      resolutionNote: body.resolutionNote,
    });
    return jsonOk(incident);
  } catch (error: unknown) {
    return errorResponse(error, 'incidents.action');
  }
}
