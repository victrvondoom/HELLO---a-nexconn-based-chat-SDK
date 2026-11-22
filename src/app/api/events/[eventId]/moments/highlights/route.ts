import { viewerRoute } from '@/lib/api-handler';
import { jsonOk, parseBody } from '@/lib/http';
import { getRuntime } from '@/lib/runtime';
import { FixedWindowRateLimiter } from '@/lib/rate-limit';
import { createHighlight, HighlightSchema, listHighlights } from '@/services/moments';

const limiter = new FixedWindowRateLimiter(20, 60_000);

/** `?owner=u-…` lists that person's highlights as the viewer may see them; without it, the viewer's own. */
export const GET = viewerRoute<{ eventId: string }>('moments.highlights', async ({ userId, params, request }) => {
  const owner = new URL(request.url).searchParams.get('owner') ?? userId;
  const { ctx } = await getRuntime();
  return jsonOk({ highlights: await listHighlights(ctx, params.eventId, userId, owner) });
});

export const POST = viewerRoute<{ eventId: string }>('moments.highlights.create', async ({ userId, params, request }) => {
  const input = await parseBody(request, HighlightSchema, 'Give the highlight a title of up to 24 characters and choose 1 to 30 of your stories.');
  const { ctx } = await getRuntime();
  limiter.consume(`highlight:${userId}`, ctx.now());
  const highlight = await createHighlight(ctx, params.eventId, userId, input);
  return jsonOk({ id: highlight.id }, 201);
});

export const dynamic = 'force-dynamic';
