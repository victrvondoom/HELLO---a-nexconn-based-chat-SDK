import { viewerRoute } from '@/lib/api-handler';
import { jsonOk } from '@/lib/http';
import { getRuntime } from '@/lib/runtime';
import { markAllNotificationsRead } from '@/services/workplace';

export const POST = viewerRoute<{ eventId: string }>('notifications.read', async ({ userId, params }) => {
  const { ctx } = await getRuntime();
  return jsonOk({ marked: await markAllNotificationsRead(ctx, params.eventId, userId) });
});
