import { viewerRoute } from '@/lib/api-handler';
import { jsonError, jsonOk, readJson } from '@/lib/http';
import { getRuntime } from '@/lib/runtime';
import { ProfileUpdateSchema, updateProfileText } from '@/services/social';

export const POST = viewerRoute('me.profile', async ({ userId, request }) => {
  const parsed = ProfileUpdateSchema.safeParse(await readJson(request));
  if (!parsed.success) return jsonError('VALIDATION_FAILED', 'Headline up to 120 characters, bio up to 600.', 422);
  const { ctx } = await getRuntime();
  await updateProfileText(ctx, userId, parsed.data);
  return jsonOk({ saved: true });
});
