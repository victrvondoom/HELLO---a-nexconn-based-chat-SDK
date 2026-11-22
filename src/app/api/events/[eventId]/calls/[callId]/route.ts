import { viewerRoute } from '@/lib/api-handler';
import { jsonOk, parseBody } from '@/lib/http';
import { getRuntime } from '@/lib/runtime';
import { FixedWindowRateLimiter } from '@/lib/rate-limit';
import { DomainError } from '@/domain/errors';
import { actOnCall, CallActionSchema, CallPollSchema, pollCall } from '@/services/calls';

/** Setting up one connection takes a few dozen small messages; 600 a minute covers a full call and stops a flood. */
const limiter = new FixedWindowRateLimiter(600, 60_000);
/** Each privacy alert notifies someone: a handful a minute is plenty, and stops a host flooding a person. */
const alertLimiter = new FixedWindowRateLimiter(10, 60_000);
type P = { eventId: string; callId: string };

export const GET = viewerRoute<P>('calls.poll', async ({ userId, params, request }) => {
  const url = new URL(request.url);
  const query = CallPollSchema.safeParse({ peerId: url.searchParams.get('peer'), since: url.searchParams.get('since') ?? 0 });
  if (!query.success) throw new DomainError('VALIDATION_FAILED', 'Join the call first.');
  const { ctx } = await getRuntime();
  return jsonOk(await pollCall(ctx, params.eventId, userId, params.callId, query.data));
});

export const POST = viewerRoute<P>('calls.act', async ({ userId, params, request }) => {
  const input = await parseBody(request, CallActionSchema, 'That call request is not valid.');
  const { ctx } = await getRuntime();
  limiter.consume(`call-act:${userId}`, ctx.now());
  if (input.action === 'privacy-alert') alertLimiter.consume(`call-alert:${userId}`, ctx.now());
  return jsonOk(await actOnCall(ctx, params.eventId, userId, params.callId, input));
});

export const dynamic = 'force-dynamic';
