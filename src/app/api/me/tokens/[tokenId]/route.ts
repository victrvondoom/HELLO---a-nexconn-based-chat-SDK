import { viewerRoute } from '@/lib/api-handler';
import { jsonOk } from '@/lib/http';
import { getRuntime } from '@/lib/runtime';
import { revokeToken } from '@/services/tokens';

export const DELETE = viewerRoute<{ tokenId: string }>('tokens.revoke', async ({ userId, params }) => {
  const { ctx } = await getRuntime();
  await revokeToken(ctx, userId, params.tokenId);
  return jsonOk({ revoked: true });
});

export const dynamic = 'force-dynamic';
