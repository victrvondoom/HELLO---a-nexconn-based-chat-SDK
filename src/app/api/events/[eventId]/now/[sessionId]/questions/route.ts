import { viewerRoute } from '@/lib/api-handler';
import { jsonOk, parseBody } from '@/lib/http';
import { getRuntime } from '@/lib/runtime';
import { consumeAction } from '@/lib/action-limits';
import { askQuestion, QuestionSchema } from '@/services/live-room';

export const POST = viewerRoute<{ eventId: string; sessionId: string }>('now.question', async ({ userId, params, request }) => {
  const input = await parseBody(request, QuestionSchema, 'Write a question of 3 to 280 characters.');
  const { ctx } = await getRuntime();
  consumeAction('live.action', userId, params.eventId, ctx.now());
  const q = await askQuestion(ctx, params.eventId, userId, params.sessionId, input.text);
  return jsonOk({ id: q.id, groupKey: q.groupKey });
});

export const dynamic = 'force-dynamic';
