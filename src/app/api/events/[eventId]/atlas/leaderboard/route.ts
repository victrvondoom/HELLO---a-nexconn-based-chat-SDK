import { z } from 'zod';
import { viewerRoute } from '@/lib/api-handler';
import { jsonOk, parseBody } from '@/lib/http';
import { getRuntime } from '@/lib/runtime';
import { leaderboard, setLeaderboardOptIn } from '@/services/leaderboard';

export const GET = viewerRoute<{ eventId: string }>('atlas.leaderboard', async ({ userId, params }) => {
  const { ctx } = await getRuntime();
  return jsonOk(await leaderboard(ctx, params.eventId, userId));
});

const OptInSchema = z.object({ optIn: z.boolean() });

export const POST = viewerRoute<{ eventId: string }>('atlas.leaderboard.optin', async ({ userId, params, request }) => {
  const input = await parseBody(request, OptInSchema, 'Choose to join or leave.');
  const { ctx } = await getRuntime();
  await setLeaderboardOptIn(ctx, params.eventId, userId, input.optIn);
  return jsonOk(await leaderboard(ctx, params.eventId, userId));
});

export const dynamic = 'force-dynamic';
