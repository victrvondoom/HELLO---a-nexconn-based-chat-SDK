import { viewerRoute } from '@/lib/api-handler';
import { jsonOk } from '@/lib/http';
import { getRuntime } from '@/lib/runtime';
import { FixedWindowRateLimiter } from '@/lib/rate-limit';
import { liveBus, people } from '@/lib/live/bus';
import { assertCanSignalTyping } from '@/services/presence';

/** The browser sends at most one signal every three seconds while someone types; this is the hard ceiling. */
const limiter = new FixedWindowRateLimiter(40, 60_000, 'Typing signals are limited. Keep typing; the message is unaffected.');

/**
 * "Typing…" in a private thread. Nothing is stored: the signal goes to the other person's open pages only,
 * and only between mutual connections. It says who is typing and nothing about what.
 */
export const POST = viewerRoute<{ eventId: string; peerId: string }>('dm.typing', async ({ userId, params }) => {
  const { ctx } = await getRuntime();
  limiter.consume(`typing:${userId}`, ctx.now());
  await assertCanSignalTyping(ctx, params.eventId, userId, params.peerId);
  liveBus().publish({ eventId: null, topic: 'typing', audience: people([params.peerId], false), at: ctx.now(), data: { from: userId } });
  return jsonOk({ sent: true });
});

export const dynamic = 'force-dynamic';
