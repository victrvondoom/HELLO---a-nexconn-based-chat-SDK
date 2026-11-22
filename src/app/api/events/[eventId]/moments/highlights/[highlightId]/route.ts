import { viewerRoute } from '@/lib/api-handler';
import { jsonOk, parseBody } from '@/lib/http';
import { getRuntime } from '@/lib/runtime';
import { FixedWindowRateLimiter } from '@/lib/rate-limit';
import { deleteHighlight, HighlightActionSchema } from '@/services/moments';

const limiter = new FixedWindowRateLimiter(30, 60_000);

export const POST = viewerRoute<{ eventId: string; highlightId: string }>('moments.highlight.act', async ({ userId, params, request }) => {
  await parseBody(request, HighlightActionSchema, 'The only action on a highlight is delete.');
  const { ctx } = await getRuntime();
  limiter.consume(`highlight-act:${userId}`, ctx.now());
  await deleteHighlight(ctx, params.eventId, userId, params.highlightId);
  return jsonOk({ done: true });
});

export const dynamic = 'force-dynamic';
