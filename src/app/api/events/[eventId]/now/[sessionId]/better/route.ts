import { viewerRoute } from '@/lib/api-handler';
import { jsonOk, parseBody } from '@/lib/http';
import { getRuntime } from '@/lib/runtime';
import { consumeAction } from '@/lib/action-limits';
import { answerBetter, BetterSchema } from '@/services/live-room';

export const POST = viewerRoute<{ eventId: string; sessionId: string }>('now.better', async ({ userId, params, request }) => {
  const input = await parseBody(request, BetterSchema, 'Say whether it is better now.');
  const { ctx } = await getRuntime();
  consumeAction('live.action', userId, params.eventId, ctx.now());
  await answerBetter(ctx, params.eventId, userId, params.sessionId, input.kind, input.better);
  return jsonOk({ saved: true });
});

export const dynamic = 'force-dynamic';
