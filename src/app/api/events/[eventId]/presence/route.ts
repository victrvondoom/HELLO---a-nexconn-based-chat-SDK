import { viewerRoute } from '@/lib/api-handler';
import { jsonOk } from '@/lib/http';
import { getRuntime } from '@/lib/runtime';
import { presenceRegistry } from '@/lib/live/presence';
import { presenceFor } from '@/services/presence';

/** Who is online: mutual connections by name, everyone else as a count hidden below the privacy minimum. */
export const GET = viewerRoute<{ eventId: string }>('live.presence', async ({ userId, params }) => {
  const { ctx } = await getRuntime();
  // Presence uses the wall clock: it is shared between instances, whose event clocks can differ.
  const online = presenceRegistry().online(params.eventId, Date.now());
  return jsonOk(await presenceFor(ctx, params.eventId, userId, online));
});

export const dynamic = 'force-dynamic';
