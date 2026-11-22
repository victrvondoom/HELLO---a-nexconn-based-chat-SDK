import { viewerRoute } from '@/lib/api-handler';
import { jsonOk } from '@/lib/http';
import { getRuntime } from '@/lib/runtime';
import { careInfo } from '@/services/live-room';

export const GET = viewerRoute<{ eventId: string }>('care', async ({ userId, params }) => {
  const { ctx } = await getRuntime();
  return jsonOk(await careInfo(ctx, params.eventId, userId));
});

export const dynamic = 'force-dynamic';
