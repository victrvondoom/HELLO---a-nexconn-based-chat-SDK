import { z } from 'zod';
import { viewerRoute } from '@/lib/api-handler';
import { jsonOk, parseBody } from '@/lib/http';
import { getRuntime } from '@/lib/runtime';
import { getPlan, PlanSchema, savePlan, togglePlanned } from '@/services/live-room';

export const GET = viewerRoute<{ eventId: string }>('plan.get', async ({ userId, params }) => {
  const { ctx } = await getRuntime();
  return jsonOk(await getPlan(ctx, params.eventId, userId));
});

export const PUT = viewerRoute<{ eventId: string }>('plan.save', async ({ userId, params, request }) => {
  const input = await parseBody(request, PlanSchema, 'Send the sessions in your plan.');
  const { ctx } = await getRuntime();
  return jsonOk(await savePlan(ctx, params.eventId, userId, input));
});

/** Add or remove one session. */
export const POST = viewerRoute<{ eventId: string }>('plan.toggle', async ({ userId, params, request }) => {
  const input = await parseBody(request, z.object({ sessionId: z.string().min(1).max(80) }), 'Choose a session.');
  const { ctx } = await getRuntime();
  return jsonOk(await togglePlanned(ctx, params.eventId, userId, input.sessionId));
});

export const dynamic = 'force-dynamic';
