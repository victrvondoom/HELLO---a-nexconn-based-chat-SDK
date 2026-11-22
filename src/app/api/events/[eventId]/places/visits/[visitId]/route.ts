import type { NextResponse } from 'next/server';
import { currentUserId } from '@/lib/session';
import { errorResponse, jsonError, jsonOk, readJson } from '@/lib/http';
import { getRuntime } from '@/lib/runtime';
import { VisitActionBody } from '@/lib/validation/places';
import { correctVisit, deleteVisit, endVisit } from '@/services/place-visits';

/** One of the person's visits: end it, correct its times, or delete it. */
export async function POST(request: Request, context: { params: Promise<{ eventId: string; visitId: string }> }): Promise<NextResponse> {
  const userId = await currentUserId();
  if (!userId) return jsonError('UNAUTHENTICATED', 'Sign in to continue.', 401);
  const { eventId, visitId } = await context.params;
  try {
    const parsed = VisitActionBody.safeParse(await readJson(request));
    if (!parsed.success) return jsonError('VALIDATION_FAILED', 'That change to the visit is not valid.', 422);
    const { ctx } = await getRuntime();
    const body = parsed.data;
    if (body.action === 'delete') {
      await deleteVisit(ctx, { eventId, userId, visitId });
      return jsonOk({ deleted: true });
    }
    if (body.action === 'end') return jsonOk(await endVisit(ctx, { eventId, userId, visitId, expectedVersion: body.expectedVersion }));
    return jsonOk(
      await correctVisit(ctx, {
        eventId,
        userId,
        visitId,
        expectedVersion: body.expectedVersion,
        arrivedAt: body.arrivedAt,
        departedAt: body.departedAt,
      }),
    );
  } catch (error: unknown) {
    return errorResponse(error, 'places.visit_change');
  }
}

export const dynamic = 'force-dynamic';
