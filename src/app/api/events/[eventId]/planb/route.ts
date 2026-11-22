import { viewerRoute } from '@/lib/api-handler';
import { jsonOk } from '@/lib/http';
import { getRuntime } from '@/lib/runtime';
import { planB } from '@/services/live-room';

export const GET = viewerRoute<{ eventId: string }>('planb', async ({ userId, params, request }) => {
  const replacing = new URL(request.url).searchParams.get('replacing');
  const { ctx } = await getRuntime();
  return jsonOk(await planB(ctx, params.eventId, userId, replacing && replacing.length <= 80 ? replacing : null));
});

export const dynamic = 'force-dynamic';
