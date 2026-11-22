import { viewerRoute } from '@/lib/api-handler';
import { jsonOk, parseBody } from '@/lib/http';
import { getRuntime } from '@/lib/runtime';
import { consumeAction } from '@/lib/action-limits';
import { listProposals, runResilienceCheck, RunCheckSchema } from '@/services/resilience';

export const GET = viewerRoute<{ eventId: string }>('resilience.list', async ({ userId, params }) => {
  const { ctx } = await getRuntime();
  return jsonOk({ proposals: await listProposals(ctx, params.eventId, userId) });
});

/** Runs a Steadfast check. Signed-in sessions only (viewerRoute): an access token or an agent cannot. */
export const POST = viewerRoute<{ eventId: string }>('resilience.check', async ({ userId, params, request }) => {
  const input = await parseBody(request, RunCheckSchema, 'Choose an incident or disruptions to check.');
  const { ctx } = await getRuntime();
  consumeAction('resilience.check', userId, params.eventId, ctx.now());
  return jsonOk({ proposal: await runResilienceCheck(ctx, params.eventId, userId, input) });
});

export const dynamic = 'force-dynamic';
