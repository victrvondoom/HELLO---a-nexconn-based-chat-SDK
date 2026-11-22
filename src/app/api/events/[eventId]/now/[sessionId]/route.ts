import { viewerRoute } from '@/lib/api-handler';
import { jsonOk } from '@/lib/http';
import { getRuntime } from '@/lib/runtime';
import { liveRoom } from '@/services/live-room';

export const GET = viewerRoute<{ eventId: string; sessionId: string }>('now.room', async ({ userId, params }) => {
  const { ctx } = await getRuntime();
  return jsonOk(await liveRoom(ctx, params.eventId, userId, params.sessionId));
});

export const dynamic = 'force-dynamic';
