import { viewerRoute } from '@/lib/api-handler';
import { jsonOk, parseBody } from '@/lib/http';
import { getRuntime } from '@/lib/runtime';
import { consumeAction } from '@/lib/action-limits';
import { SignalSchema, signalAv } from '@/services/live-room';

/** "Can't hear" / "Can't see": an operational signal, deduplicated per person. */
export const POST = viewerRoute<{ eventId: string; sessionId: string }>('now.signal', async ({ userId, params, request }) => {
  const input = await parseBody(request, SignalSchema, "Choose can't hear or can't see.");
  const { ctx } = await getRuntime();
  consumeAction('live.action', userId, params.eventId, ctx.now());
  return jsonOk(await signalAv(ctx, params.eventId, userId, params.sessionId, input.kind));
});

export const dynamic = 'force-dynamic';
