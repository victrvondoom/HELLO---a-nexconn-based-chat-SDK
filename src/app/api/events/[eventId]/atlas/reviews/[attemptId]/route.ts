import { z } from 'zod';
import { viewerRoute } from '@/lib/api-handler';
import { jsonOk, parseBody } from '@/lib/http';
import { getRuntime } from '@/lib/runtime';
import { reviewAttempt } from '@/services/field-atlas';

const ReviewSchema = z.object({
  decision: z.enum(['APPROVE', 'REJECT']),
  note: z.string().trim().max(300).default(''),
});

/**
 * Next.js has already decoded the route parameter. Decoding it again threw a URIError for any id with a
 * stray `%` (an unhandled 500). An id that still looks encoded is decoded once; anything malformed is used as is,
 * and the service answers NOT_FOUND for it.
 */
function attemptIdFrom(raw: string): string {
  if (!/%[0-9A-Fa-f]{2}/.test(raw)) return raw;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

export const POST = viewerRoute<{ eventId: string; attemptId: string }>('atlas.review', async ({ userId, params, request }) => {
  const input = await parseBody(request, ReviewSchema, 'Choose approve or reject.');
  const { ctx } = await getRuntime();
  return jsonOk(await reviewAttempt(ctx, params.eventId, userId, attemptIdFrom(params.attemptId), input.decision, input.note));
});
