import { viewerRoute } from '@/lib/api-handler';
import { jsonOk, parseBody } from '@/lib/http';
import { getRuntime } from '@/lib/runtime';
import { consumeAction } from '@/lib/action-limits';
import { runWorkflow, RunSchema } from '@/services/workflows';

export const POST = viewerRoute<{ eventId: string }>('flow.run', async ({ userId, params, request }) => {
  const input = await parseBody(request, RunSchema, 'Choose a workflow.');
  const { ctx } = await getRuntime();
  consumeAction('workflow.run', userId, params.eventId, ctx.now());
  return jsonOk({ run: await runWorkflow(ctx, params.eventId, userId, input.workflowId, 'CANVAS') });
});
