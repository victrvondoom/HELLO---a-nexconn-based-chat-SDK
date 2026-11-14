import { viewerRoute } from '@/lib/api-handler';
import { jsonOk, parseBody } from '@/lib/http';
import { getRuntime } from '@/lib/runtime';
import { FixedWindowRateLimiter } from '@/lib/rate-limit';
import { runWorkflow, RunSchema } from '@/services/workflows';

const limiter = new FixedWindowRateLimiter(10, 60_000);

export const POST = viewerRoute<{ eventId: string }>('flow.run', async ({ userId, params, request }) => {
  const input = await parseBody(request, RunSchema, 'Choose a workflow.');
  const { ctx } = await getRuntime();
  limiter.consume(`run:${userId}`, ctx.now());
  return jsonOk({ run: await runWorkflow(ctx, params.eventId, userId, input.workflowId, 'CANVAS') });
});
