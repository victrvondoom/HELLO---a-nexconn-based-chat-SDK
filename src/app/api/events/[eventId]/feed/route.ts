import { viewerRoute } from '@/lib/api-handler';
import { jsonOk, parseBody } from '@/lib/http';
import { getRuntime } from '@/lib/runtime';
import { consumeAction } from '@/lib/action-limits';
import { DomainError } from '@/domain/errors';
import { createPost, FeedQuerySchema, listFeed, PostSchema } from '@/services/feed';

export const GET = viewerRoute<{ eventId: string }>('feed.list', async ({ userId, params, request }) => {
  const url = new URL(request.url);
  const query = FeedQuerySchema.safeParse({ scope: url.searchParams.get('scope') ?? undefined, communityId: url.searchParams.get('community'), authorId: url.searchParams.get('author') });
  if (!query.success) throw new DomainError('VALIDATION_FAILED', 'That feed does not exist.');
  const { ctx } = await getRuntime();
  return jsonOk({ now: ctx.now(), posts: await listFeed(ctx, params.eventId, userId, query.data) });
});

export const POST = viewerRoute<{ eventId: string }>('feed.create', async ({ userId, params, request }) => {
  const input = await parseBody(request, PostSchema, 'Write up to 1000 characters, or attach a picture or video.');
  const { ctx } = await getRuntime();
  consumeAction('post.create', userId, params.eventId, ctx.now());
  const post = await createPost(ctx, params.eventId, userId, input);
  return jsonOk({ id: post.id }, 201);
});
