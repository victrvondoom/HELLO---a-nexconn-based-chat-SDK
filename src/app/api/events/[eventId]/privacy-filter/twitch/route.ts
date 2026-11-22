import { z } from 'zod';
import { viewerRoute } from '@/lib/api-handler';
import { jsonOk, parseBody } from '@/lib/http';
import { getRuntime } from '@/lib/runtime';
import { FixedWindowRateLimiter } from '@/lib/rate-limit';
import { disconnectTwitch, startTwitch } from '@/services/privacy-twitch';

const limiter = new FixedWindowRateLimiter(20, 60_000);
type P = { eventId: string };

const TwitchSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('start'), clientId: z.string().max(100) }),
  z.object({ action: z.literal('disconnect') }),
]);

/**
 * The Twitch redirect URL the person registers is this origin's /twitch/callback. HELLO_PUBLIC_URL overrides the
 * request origin when HELLO runs behind a proxy that rewrites it.
 */
function callbackUrl(request: Request): string {
  const base = process.env.HELLO_PUBLIC_URL?.replace(/\/+$/, '') || new URL(request.url).origin;
  return `${base}/twitch/callback`;
}

export const POST = viewerRoute<P>('privacy-filter.twitch', async ({ userId, params, request }) => {
  const input = await parseBody(request, TwitchSchema, 'That Twitch request is not valid.');
  const { ctx } = await getRuntime();
  limiter.consume(`twitch:${userId}`, ctx.now());
  if (input.action === 'disconnect') return jsonOk({ disconnected: disconnectTwitch(userId) });
  return jsonOk({ ...(await startTwitch(ctx, params.eventId, userId, input.clientId, callbackUrl(request))), redirectUri: callbackUrl(request) });
});

export const dynamic = 'force-dynamic';
