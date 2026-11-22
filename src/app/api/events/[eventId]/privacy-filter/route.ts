import { z } from 'zod';
import { viewerRoute } from '@/lib/api-handler';
import { jsonOk, parseBody } from '@/lib/http';
import { getRuntime } from '@/lib/runtime';
import { FixedWindowRateLimiter } from '@/lib/rate-limit';
import { PrivacyFilterPatchSchema } from '@/domain/privacy-filter/settings';
import { acknowledgePrivacyAlert, getPrivacyFilter, listPrivacyAlerts, updatePrivacyFilter } from '@/services/privacy-filter';
import { twitchState } from '@/services/privacy-twitch';

/** Settings changes restart the filter; 60 a minute is far more than a person makes by hand. */
const limiter = new FixedWindowRateLimiter(60, 60_000);
type P = { eventId: string };

const AckSchema = z.object({ action: z.literal('ack'), alertId: z.string().min(3).max(80) });

export const GET = viewerRoute<P>('privacy-filter.get', async ({ userId, params }) => {
  const { ctx } = await getRuntime();
  const [settings, alerts, twitch] = await Promise.all([
    getPrivacyFilter(ctx, params.eventId, userId),
    listPrivacyAlerts(ctx, params.eventId, userId),
    twitchState(ctx, params.eventId, userId),
  ]);
  // The caller's own id: the page uses it to pick this person's people-kept-visible on a shared device.
  return jsonOk({ settings, alerts, twitch, userId });
});

export const PUT = viewerRoute<P>('privacy-filter.update', async ({ userId, params, request }) => {
  const patch = await parseBody(request, PrivacyFilterPatchSchema, 'Those privacy filter settings are not valid: 5 to 60 fps, a 1 to 30 second lookahead, and on/off switches.');
  const { ctx } = await getRuntime();
  limiter.consume(`privacy-filter:${userId}`, ctx.now());
  return jsonOk(await updatePrivacyFilter(ctx, params.eventId, userId, patch));
});

export const POST = viewerRoute<P>('privacy-filter.ack', async ({ userId, params, request }) => {
  const input = await parseBody(request, AckSchema, 'That request is not valid.');
  const { ctx } = await getRuntime();
  limiter.consume(`privacy-filter:${userId}`, ctx.now());
  return jsonOk(await acknowledgePrivacyAlert(ctx, params.eventId, userId, input.alertId));
});

export const dynamic = 'force-dynamic';
