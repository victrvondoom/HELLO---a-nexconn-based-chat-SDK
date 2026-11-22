import { viewerRoute } from '@/lib/api-handler';
import { jsonOk } from '@/lib/http';
import { getRuntime } from '@/lib/runtime';
import { consumeAction } from '@/lib/action-limits';
import { voteQuestion } from '@/services/live-room';

export const POST = viewerRoute<{ eventId: string; questionId: string }>('now.vote', async ({ userId, params }) => {
  const { ctx } = await getRuntime();
  consumeAction('live.action', userId, params.eventId, ctx.now());
  await voteQuestion(ctx, params.eventId, userId, params.questionId);
  return jsonOk({ saved: true });
});

export const dynamic = 'force-dynamic';
