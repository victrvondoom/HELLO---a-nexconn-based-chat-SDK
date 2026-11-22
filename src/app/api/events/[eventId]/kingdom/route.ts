import { viewerRoute } from '@/lib/api-handler';
import { jsonOk, parseBody } from '@/lib/http';
import { getRuntime } from '@/lib/runtime';
import { FixedWindowRateLimiter } from '@/lib/rate-limit';
import { FoundSchema, foundKingdom, kingdomAction, kingdomView, KingdomActionSchema } from '@/services/kingdoms';

// Walking is frequent and cheap; everything else is rare and changes the world for everyone.
const walkLimiter = new FixedWindowRateLimiter(240, 60_000);
const actLimiter = new FixedWindowRateLimiter(30, 60_000);
const foundLimiter = new FixedWindowRateLimiter(3, 60_000);

export const GET = viewerRoute<{ eventId: string }>('kingdom.view', async ({ userId, params }) => {
  const { ctx } = await getRuntime();
  return jsonOk(await kingdomView(ctx, params.eventId, userId));
});

/** Founds the event's kingdom. */
export const PUT = viewerRoute<{ eventId: string }>('kingdom.found', async ({ userId, params, request }) => {
  const input = await parseBody(request, FoundSchema, 'Give the kingdom a name (up to 40 characters) and, if you like, a motto.');
  const { ctx } = await getRuntime();
  foundLimiter.consume(`kingdom-found:${userId}`, ctx.now());
  const kingdom = await foundKingdom(ctx, params.eventId, userId, input);
  return jsonOk({ id: kingdom.id }, 201);
});

export const POST = viewerRoute<{ eventId: string }>('kingdom.act', async ({ userId, params, request }) => {
  const input = await parseBody(request, KingdomActionSchema, 'That is not something a citizen can do.');
  const { ctx } = await getRuntime();
  (input.action === 'move' ? walkLimiter : actLimiter).consume(`kingdom:${input.action === 'move' ? 'walk' : 'act'}:${userId}`, ctx.now());
  return jsonOk(await kingdomAction(ctx, params.eventId, userId, input));
});

export const dynamic = 'force-dynamic';
