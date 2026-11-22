import { viewerRoute } from '@/lib/api-handler';
import { jsonOk } from '@/lib/http';
import { getRuntime } from '@/lib/runtime';
import { FixedWindowRateLimiter } from '@/lib/rate-limit';
import { searchEvent } from '@/services/search';

/** The palette searches as the person types; this is a ceiling, well above normal typing. */
const limiter = new FixedWindowRateLimiter(90, 60_000, 'Searching too quickly. Wait a moment.');

export const GET = viewerRoute<{ eventId: string }>('search', async ({ userId, params, request }) => {
  const { ctx } = await getRuntime();
  limiter.consume(`search:${userId}`, ctx.now());
  return jsonOk(await searchEvent(ctx, params.eventId, userId, new URL(request.url).searchParams.get('q') ?? ''));
});

export const dynamic = 'force-dynamic';
