import { viewerRoute } from '@/lib/api-handler';
import { jsonOk, parseBody } from '@/lib/http';
import { getRuntime } from '@/lib/runtime';
import { decideProposal, DecideSchema } from '@/services/resilience';

/** Approve or reject a verified proposal. A human decision through a signed-in session; never automatic. */
export const POST = viewerRoute<{ eventId: string; proposalId: string }>('resilience.decide', async ({ userId, params, request }) => {
  const input = await parseBody(request, DecideSchema, 'Approve or reject.');
  const { ctx } = await getRuntime();
  return jsonOk({ proposal: await decideProposal(ctx, params.eventId, userId, params.proposalId, input.decision) });
});

export const dynamic = 'force-dynamic';
