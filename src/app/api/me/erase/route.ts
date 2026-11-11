import { z } from 'zod';
import { viewerRoute } from '@/lib/api-handler';
import { jsonError, jsonOk, readJson } from '@/lib/http';
import { getRuntime } from '@/lib/runtime';
import { eraseMe } from '@/services/rights';

const Body = z.object({ confirm: z.literal('ERASE') });

export const POST = viewerRoute('me.erase', async ({ userId, request }) => {
  if (!Body.safeParse(await readJson(request)).success) {
    return jsonError('VALIDATION_FAILED', 'Type ERASE to confirm.', 422);
  }
  const { ctx } = await getRuntime();
  return jsonOk(await eraseMe(ctx, userId));
});
