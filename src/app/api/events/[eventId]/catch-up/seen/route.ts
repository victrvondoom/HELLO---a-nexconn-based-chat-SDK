import { cookies } from 'next/headers';
import { viewerRoute } from '@/lib/api-handler';
import { jsonOk } from '@/lib/http';
import { getRuntime } from '@/lib/runtime';
import { seenCookieName } from '@/domain/catchup/window';
import { requireCapability } from '@/services/context';

/** Remember, in this browser only, when the viewer last caught up. Nothing about it is stored on the server. */
export const POST = viewerRoute<{ eventId: string }>('catchup.seen', async ({ userId, params }) => {
  const { ctx } = await getRuntime();
  await requireCapability(ctx, params.eventId, userId, 'event.read');
  const at = ctx.now();
  (await cookies()).set(seenCookieName(params.eventId), String(at), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
  });
  return jsonOk({ seenAt: at });
});

export const dynamic = 'force-dynamic';
