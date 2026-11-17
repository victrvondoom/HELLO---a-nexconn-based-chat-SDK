import { viewerRoute } from '@/lib/api-handler';
import { jsonOk, parseBody } from '@/lib/http';
import { getRuntime } from '@/lib/runtime';
import { FixedWindowRateLimiter } from '@/lib/rate-limit';
import { GameActionSchema, playGame, viewGame } from '@/services/games';

const limiter = new FixedWindowRateLimiter(120, 60_000);
type P = { eventId: string; gameId: string };

export const GET = viewerRoute<P>('games.view', async ({ userId, params }) => {
  const { ctx } = await getRuntime();
  return jsonOk({ game: await viewGame(ctx, params.eventId, userId, params.gameId) });
});

export const POST = viewerRoute<P>('games.play', async ({ userId, params, request }) => {
  const input = await parseBody(request, GameActionSchema, 'That move is not valid.');
  const { ctx } = await getRuntime();
  limiter.consume(`game-act:${userId}`, ctx.now());
  await playGame(ctx, params.eventId, userId, params.gameId, input);
  return jsonOk({ game: await viewGame(ctx, params.eventId, userId, params.gameId) });
});
