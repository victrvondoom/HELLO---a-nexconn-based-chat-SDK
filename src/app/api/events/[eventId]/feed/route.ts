import { viewerRoute } from '@/lib/api-handler';
import { jsonOk, parseBody } from '@/lib/http';
import { getRuntime } from '@/lib/runtime';
import { consumeAction } from '@/lib/action-limits';
import { DomainError } from '@/domain/errors';
import { FEED_CRITERIA, NEVER_USED } from '@/domain/moments/charter';
import { createPost, FeedQuerySchema, listFeed, PostSchema, RANKED_SCOPES } from '@/services/feed';

export const GET = viewerRoute<{ eventId: string }>('feed.list', async ({ userId, params, request }) => {
  const url = new URL(request.url);
  const query = FeedQuerySchema.safeParse({ scope: url.searchParams.get('scope') ?? undefined, communityId: url.searchParams.get('community'), authorId: url.searchParams.get('author') });
  if (!query.success) throw new DomainError('VALIDATION_FAILED', 'That feed does not exist.');
  const { ctx } = await getRuntime();
  const now = ctx.now();
  const posts = await listFeed(ctx, params.eventId, userId, query.data);
  // A ranked feed carries its charter, so the explanation always arrives with the order it explains.
  const charter = RANKED_SCOPES.includes(query.data.scope) ? { charter: { criteria: FEED_CRITERIA, neverUsed: NEVER_USED } } : {};
  return jsonOk({ now, posts, ...charter });
});

export const POST = viewerRoute<{ eventId: string }>('feed.create', async ({ userId, params, request }) => {
  const input = await parseBody(request, PostSchema, 'Write up to 1000 characters, or attach a picture or video.');
  const { ctx } = await getRuntime();
  consumeAction('post.create', userId, params.eventId, ctx.now());
  const post = await createPost(ctx, params.eventId, userId, input);
  return jsonOk({ id: post.id }, 201);
});

export const dynamic = 'force-dynamic';
