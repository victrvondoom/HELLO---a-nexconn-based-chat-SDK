import { z } from 'zod';
import { viewerRoute } from '@/lib/api-handler';
import { jsonError, jsonOk, readJson } from '@/lib/http';
import { getRuntime } from '@/lib/runtime';
import { publishKey } from '@/services/private-messages';

const Body = z.object({ publicKey: z.unknown() });

/** Publishes this device's public key. Private keys are never sent; there is no endpoint that would accept one. */
export const POST = viewerRoute('me.keys', async ({ userId, request }) => {
  const parsed = Body.safeParse(await readJson(request));
  if (!parsed.success) return jsonError('VALIDATION_FAILED', 'Send a public key.', 422);
  const { ctx } = await getRuntime();
  const bundle = await publishKey(ctx, userId, parsed.data.publicKey);
  return jsonOk(bundle, 201);
});
