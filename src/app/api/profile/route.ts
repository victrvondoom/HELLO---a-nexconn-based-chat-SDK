import { viewerRoute } from '@/lib/api-handler';
import { jsonError, jsonOk, readJson } from '@/lib/http';
import { ProfileBody } from '@/lib/validation/api';
import { getRuntime } from '@/lib/runtime';
import { updateProfile } from '@/services/workplace';

export const POST = viewerRoute('profile.update', async ({ userId, request }) => {
  const parsed = ProfileBody.safeParse(await readJson(request));
  if (!parsed.success) return jsonError('VALIDATION_FAILED', 'Check the profile fields and try again.', 422);
  const { ctx } = await getRuntime();
  const user = await updateProfile(ctx, userId, parsed.data);
  return jsonOk(user);
});
