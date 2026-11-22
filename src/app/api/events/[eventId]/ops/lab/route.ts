import { viewerRoute } from '@/lib/api-handler';
import { jsonOk } from '@/lib/http';
import { getRuntime } from '@/lib/runtime';
import { consumeAction } from '@/lib/action-limits';
import { requireCapability } from '@/services/context';
import { runReliabilityLab } from '@/services/ops/reliability-lab';

/** Runs the Reliability Lab in-process (isolated scratch store; never touches event data). Staff only. */
export const POST = viewerRoute<{ eventId: string }>('ops.lab', async ({ userId, params }) => {
  const { ctx } = await getRuntime();
  await requireCapability(ctx, params.eventId, userId, 'approval.request');
  consumeAction('resilience.check', userId, params.eventId, ctx.now());
  return jsonOk(await runReliabilityLab({ seed: 1 }));
});

export const dynamic = 'force-dynamic';
