import { z } from 'zod';
import { viewerRoute } from '@/lib/api-handler';
import { jsonOk, parseBody } from '@/lib/http';
import { getRuntime } from '@/lib/runtime';
import { reviewAttempt } from '@/services/field-atlas';

const ReviewSchema = z.object({
  decision: z.enum(['APPROVE', 'REJECT']),
  note: z.string().trim().max(300).default(''),
});

export const POST = viewerRoute<{ eventId: string; attemptId: string }>('atlas.review', async ({ userId, params, request }) => {
  const input = await parseBody(request, ReviewSchema, 'Choose approve or reject.');
  const { ctx } = await getRuntime();
  return jsonOk(await reviewAttempt(ctx, params.eventId, userId, decodeURIComponent(params.attemptId), input.decision, input.note));
});
