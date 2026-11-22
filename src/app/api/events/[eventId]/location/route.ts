import { viewerRoute } from '@/lib/api-handler';
import { jsonOk, parseBody } from '@/lib/http';
import { getRuntime } from '@/lib/runtime';
import { FixedWindowRateLimiter } from '@/lib/rate-limit';
import { mapView, shareLocation, ShareSchema, stopSharing } from '@/services/location';

const limiter = new FixedWindowRateLimiter(30, 60_000);
type P = { eventId: string };

export const GET = viewerRoute<P>('location.map', async ({ userId, params }) => {
  const { ctx } = await getRuntime();
  // The country list never changes, so it is rendered with the page rather than sent on every poll.
  return jsonOk({ ...(await mapView(ctx, params.eventId, userId)), countryOptions: undefined });
});

export const POST = viewerRoute<P>('location.share', async ({ userId, params, request }) => {
  const input = await parseBody(request, ShareSchema, 'Choose who can see your location and for how long.');
  const { ctx } = await getRuntime();
  limiter.consume(`location:${userId}`, ctx.now());
  return jsonOk(await shareLocation(ctx, params.eventId, userId, input));
});

export const DELETE = viewerRoute<P>('location.stop', async ({ userId, params }) => {
  const { ctx } = await getRuntime();
  await stopSharing(ctx, params.eventId, userId);
  return jsonOk({ sharing: false });
});

export const dynamic = 'force-dynamic';
