import { viewerRoute } from '@/lib/api-handler';
import { jsonError, jsonOk, readJson } from '@/lib/http';
import { AnnouncementBody } from '@/lib/validation/api';
import { getRuntime } from '@/lib/runtime';
import { requestAnnouncement } from '@/services/workplace';

export const POST = viewerRoute<{ eventId: string }>('announcements.request', async ({ userId, params, request }) => {
  const parsed = AnnouncementBody.safeParse(await readJson(request));
  if (!parsed.success) return jsonError('VALIDATION_FAILED', 'Give the announcement a title and a message.', 422);
  const { ctx } = await getRuntime();
  const approval = await requestAnnouncement(ctx, params.eventId, userId, parsed.data.title, parsed.data.body);
  return jsonOk(approval, 201);
});
