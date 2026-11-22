import { viewerRoute } from '@/lib/api-handler';
import { jsonOk, parseBody } from '@/lib/http';
import { getRuntime } from '@/lib/runtime';
import { FixedWindowRateLimiter } from '@/lib/rate-limit';
import { createToken, listTokens, TokenSchema } from '@/services/tokens';

const limiter = new FixedWindowRateLimiter(10, 60 * 60_000);

export const GET = viewerRoute('tokens.list', async ({ userId }) => {
  const { ctx } = await getRuntime();
  return jsonOk({ tokens: await listTokens(ctx, userId) });
});

export const POST = viewerRoute('tokens.create', async ({ userId, request }) => {
  const input = await parseBody(request, TokenSchema, 'Give the token a name of up to 60 characters.');
  const { ctx } = await getRuntime();
  limiter.consume(`token:${userId}`, ctx.now());
  return jsonOk({ token: await createToken(ctx, userId, input) }, 201);
});

export const dynamic = 'force-dynamic';
