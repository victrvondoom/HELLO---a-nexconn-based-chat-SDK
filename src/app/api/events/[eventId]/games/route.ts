import { viewerRoute } from '@/lib/api-handler';
import { jsonOk, parseBody } from '@/lib/http';
import { getRuntime } from '@/lib/runtime';
import { FixedWindowRateLimiter } from '@/lib/rate-limit';
import { createGame, GameCreateSchema, listGames } from '@/services/games';

const limiter = new FixedWindowRateLimiter(10, 60_000);

export const GET = viewerRoute<{ eventId: string }>('games.list', async ({ userId, params }) => {
  const { ctx } = await getRuntime();
  return jsonOk({ games: await listGames(ctx, params.eventId, userId) });
});

export const POST = viewerRoute<{ eventId: string }>('games.create', async ({ userId, params, request }) => {
  const input = await parseBody(request, GameCreateSchema, 'Choose a game.');
  const { ctx } = await getRuntime();
  limiter.consume(`game:${userId}`, ctx.now());
  const game = await createGame(ctx, params.eventId, userId, input.kind);
  return jsonOk({ id: game.id }, 201);
});

export const dynamic = 'force-dynamic';
