import { z } from 'zod';
import { DomainError } from '../domain/errors';
import { roleHasCapability } from '../domain/permissions';
import { BACKDROPS, type Backdrop, type MediaKind, type MediaMeta, type Post } from '../domain/product';
import { compareIds, rankFeed, type CriterionId, type RankViewer } from '../domain/moments/charter';
import { checkAttachment, isRepeat, POST_TEXT_MAX, refuse, tooLong, tooManyTags } from '../domain/moments/rules';
import { audienceAllows, isExpired } from '../domain/moments/stories';
import { extractTags } from '../domain/moments/tags';
import { nexconnRef, postEnvelope, type NexconnRef } from '../integrations/nexconn/moments';
import { notify, requireCapability, type ServiceContext } from './context';

/**
 * The social feed: posts with text, a picture or a video, likes, comments and shares.
 *
 * Everything is scoped to one event. A post, comment or media file is only ever read through its
 * event, and the event id comes from the viewer's membership check, never from the record alone, so
 * guessing an id from another event returns "not found".
 *
 * The "Everyone" and "Visual" feeds are ordered by the Open Feed Charter (src/domain/moments/charter.ts);
 * the other feeds are newest first. Posting rules R1 to R3 and R5 (src/domain/moments/rules.ts) apply to
 * every post, whoever writes it: a person, a workflow or an access token.
 */

export const ID = /^[a-z]{2,6}[_-][a-z0-9-]{1,40}$/;
const id = z.string().regex(ID);

export const POST_MAX = POST_TEXT_MAX;
export const COMMENT_MAX = 500;
export const MEDIA_LIMITS = { IMAGE: 4 * 1024 * 1024, VIDEO: 24 * 1024 * 1024, perPerson: 96 * 1024 * 1024 } as const;
export const MEDIA_MAX_BYTES = MEDIA_LIMITS.VIDEO;

const MEDIA_TYPES: Record<string, MediaKind> = {
  'image/png': 'IMAGE',
  'image/jpeg': 'IMAGE',
  'image/webp': 'IMAGE',
  'image/gif': 'IMAGE',
  'video/mp4': 'VIDEO',
  'video/webm': 'VIDEO',
};

/** The file's own first bytes must agree with the type the browser claimed. */
function sniff(bytes: Uint8Array): string | null {
  const at = (offset: number, text: string) => Array.from({ length: text.length }, (_, i) => i).every((i) => bytes[offset + i] === text.charCodeAt(i));
  if (bytes[0] === 0x89 && at(1, 'PNG')) return 'image/png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (at(0, 'GIF8')) return 'image/gif';
  if (at(0, 'RIFF') && at(8, 'WEBP')) return 'image/webp';
  if (at(4, 'ftyp')) return 'video/mp4';
  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return 'video/webm';
  return null;
}

export async function uploadMedia(ctx: ServiceContext, eventId: string, userId: string, claimedType: string, bytes: Uint8Array): Promise<MediaMeta> {
  await requireCapability(ctx, eventId, userId, 'message.send');
  const mime = claimedType.split(';')[0]?.trim().toLowerCase() ?? '';
  const kind = MEDIA_TYPES[mime];
  if (!kind || sniff(bytes) !== mime) throw new DomainError('VALIDATION_FAILED', 'Upload a PNG, JPEG, WebP or GIF picture, or an MP4 or WebM video.');
  if (bytes.byteLength > MEDIA_LIMITS[kind]) {
    throw new DomainError('VALIDATION_FAILED', kind === 'IMAGE' ? 'Pictures can be up to 4 MB.' : 'Videos can be up to 24 MB.');
  }
  const mine = await ctx.store.docList('media', { ownerId: userId });
  if (mine.reduce((sum, m) => sum + m.size, 0) + bytes.byteLength > MEDIA_LIMITS.perPerson) {
    throw new DomainError('VALIDATION_FAILED', 'You have reached your 96 MB media allowance. Delete a post with media to free space.');
  }
  const meta: MediaMeta = { id: ctx.newId('med'), eventId, ownerId: userId, kind, mime, size: bytes.byteLength, createdAt: ctx.now() };
  await ctx.store.blobPut(meta.id, bytes);
  await ctx.store.docPut('media', meta);
  return meta;
}

export async function readMedia(ctx: ServiceContext, eventId: string, userId: string, mediaId: string): Promise<{ meta: MediaMeta; bytes: Uint8Array }> {
  await requireCapability(ctx, eventId, userId, 'event.read');
  const meta = ID.test(mediaId) ? await ctx.store.docGet('media', mediaId) : null;
  const bytes = meta && meta.eventId === eventId ? await ctx.store.blobGet(meta.id) : null;
  if (!meta || !bytes || !(await storyAllowsMedia(ctx, eventId, userId, meta.id))) throw new DomainError('NOT_FOUND', 'That file does not exist.');
  return { meta, bytes };
}

/**
 * A story's picture or video is served only to people who may see the story, so a followers-only or
 * expired story cannot be reached through its file. Post media follows the post, which every member sees.
 */
async function storyAllowsMedia(ctx: ServiceContext, eventId: string, userId: string, mediaId: string): Promise<boolean> {
  const story = (await ctx.store.docList('stories', { eventId, mediaId }))[0];
  if (!story || story.authorId === userId) return true;
  const follows = (await ctx.store.listFollowing(userId)).some((f) => f.followeeId === story.authorId);
  if (!audienceAllows(story, userId, follows)) return false;
  if (!isExpired(story, ctx.now())) return true;
  const highlights = await ctx.store.docList('storyHighlights', { eventId, ownerId: story.authorId });
  return highlights.some((h) => h.storyIds.includes(story.id));
}

/**
 * Rule R5 for an attachment. Returns the file's kind, or throws a refusal that names the rule. A file
 * that is missing or someone else's gets the same answer, so it never confirms another person's upload.
 * A file already attached elsewhere is refused because deleting either post would delete it for both.
 */
export async function attachable(ctx: ServiceContext, eventId: string, userId: string, mediaId: string, wanted: MediaKind | 'ANY'): Promise<MediaKind> {
  const meta = ID.test(mediaId) ? await ctx.store.docGet('media', mediaId) : null;
  const inUse = meta ? (await ctx.store.docList('posts', { mediaId: meta.id })).length + (await ctx.store.docList('stories', { mediaId: meta.id })).length > 0 : false;
  const outcome = checkAttachment(meta && { eventId: meta.eventId, ownerId: meta.ownerId, kind: meta.kind, inUse }, { eventId, userId }, wanted);
  if (outcome === 'NOT_YOURS' || !meta) throw refuse('R5-media', 'NOT_FOUND');
  if (outcome !== 'OK') throw refuse('R5-media');
  return meta.kind;
}

export const PostSchema = z
  .object({
    text: z.string().trim().max(POST_MAX),
    mediaId: id.nullable().default(null),
    communityId: id.nullable().default(null),
    repostOf: id.nullable().default(null),
    backdrop: z.enum(BACKDROPS).nullable().default(null),
  })
  .refine((p) => p.text.length > 0 || p.mediaId !== null || p.repostOf !== null);

/** The schema's output, with `backdrop` optional so callers written before Moments (workflows, MCP) keep working. */
export type PostInput = Omit<z.infer<typeof PostSchema>, 'backdrop'> & { backdrop?: Backdrop | null };

export const PostActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('like'), on: z.boolean() }),
  z.object({ action: z.literal('comment'), text: z.string().trim().min(1).max(COMMENT_MAX) }),
  z.object({ action: z.literal('delete') }),
]);

export async function eventPost(ctx: ServiceContext, eventId: string, postId: string): Promise<Post> {
  const post = ID.test(postId) ? await ctx.store.docGet('posts', postId) : null;
  if (!post || post.eventId !== eventId) throw new DomainError('NOT_FOUND', 'That post does not exist.');
  return post;
}

export async function createPost(ctx: ServiceContext, eventId: string, userId: string, input: PostInput): Promise<Post> {
  await requireCapability(ctx, eventId, userId, 'message.send');
  if (tooLong(input.text, 'POST')) throw refuse('R1-length');
  if (tooManyTags(input.text)) throw refuse('R2-tags');
  if (isRepeat(input.text, await ctx.store.docList('posts', { eventId, authorId: userId }), ctx.now())) throw refuse('R3-duplicate');
  // Only your own upload, from this event and not attached anywhere else, can be attached.
  const mediaKind: MediaKind | null = input.mediaId ? await attachable(ctx, eventId, userId, input.mediaId, 'ANY') : null;
  if (input.communityId) {
    const community = await ctx.store.docGet('communities', input.communityId);
    if (!community || community.eventId !== eventId) throw new DomainError('NOT_FOUND', 'That community does not exist.');
    if (!community.memberIds.includes(userId)) throw new DomainError('FORBIDDEN', 'Join the community to post in it.');
  }
  let original: Post | null = null;
  if (input.repostOf) {
    original = await eventPost(ctx, eventId, input.repostOf);
    // A share of a share points at the original, so chains stay one level deep.
    if (original.repostOf) original = await eventPost(ctx, eventId, original.repostOf);
  }
  const post: Post = {
    id: ctx.newId('pst'),
    eventId,
    authorId: userId,
    communityId: input.communityId,
    text: input.text,
    mediaId: input.mediaId,
    mediaKind,
    // A backdrop is drawn behind text only: a picture or video brings its own.
    backdrop: input.mediaId === null && input.text.length > 0 ? (input.backdrop ?? null) : null,
    repostOf: original?.id ?? null,
    likes: [],
    createdAt: ctx.now(),
  };
  await ctx.store.docPut('posts', post);
  if (original && original.authorId !== userId) {
    const actor = await ctx.store.getUser(userId);
    await notify(ctx, {
      eventId,
      recipientUserId: original.authorId,
      kind: 'POST_SHARED',
      body: `${actor?.displayName ?? 'Someone'} shared your post.`,
      href: `/events/${eventId}/feed`,
      dedupeParts: [original.id, userId],
    });
  }
  return post;
}

export async function actOnPost(ctx: ServiceContext, eventId: string, userId: string, postId: string, input: z.infer<typeof PostActionSchema>): Promise<void> {
  const membership = await requireCapability(ctx, eventId, userId, input.action === 'like' ? 'event.read' : 'message.send');
  const post = await eventPost(ctx, eventId, postId);
  const actor = await ctx.store.getUser(userId);
  const who = actor?.displayName ?? 'Someone';
  if (input.action === 'like') {
    await ctx.store.docMutate('posts', post.id, (p) => {
      const likes = p.likes.filter((u) => u !== userId);
      return { ...p, likes: input.on ? [...likes, userId] : likes };
    });
    if (input.on && post.authorId !== userId) {
      await notify(ctx, { eventId, recipientUserId: post.authorId, kind: 'POST_LIKED', body: `${who} liked your post.`, href: `/events/${eventId}/feed`, dedupeParts: [post.id, userId] });
    }
    return;
  }
  if (input.action === 'comment') {
    const comment = { id: ctx.newId('cmt'), eventId, postId: post.id, authorId: userId, text: input.text, createdAt: ctx.now() };
    await ctx.store.docPut('comments', comment);
    if (post.authorId !== userId) {
      await notify(ctx, { eventId, recipientUserId: post.authorId, kind: 'POST_COMMENT', body: `${who} commented on your post.`, href: `/events/${eventId}/feed`, dedupeParts: [comment.id] });
    }
    return;
  }
  if (post.authorId !== userId && !roleHasCapability(membership.role, 'content.moderate')) {
    throw new DomainError('FORBIDDEN', 'Only the author or an organiser can delete a post.');
  }
  await deletePost(ctx, post);
}

export async function deletePost(ctx: ServiceContext, post: Post): Promise<void> {
  await ctx.store.docDelete('posts', post.id);
  for (const c of await ctx.store.docList('comments', { postId: post.id })) await ctx.store.docDelete('comments', c.id);
  // A save of a deleted post would point at nothing.
  for (const s of await ctx.store.docList('savedPosts', { postId: post.id })) await ctx.store.docDelete('savedPosts', s.id);
  for (const share of await ctx.store.docList('posts', { repostOf: post.id })) await deletePost(ctx, share);
  if (post.mediaId) {
    await ctx.store.docDelete('media', post.mediaId);
    await ctx.store.blobDelete(post.mediaId);
  }
}

export interface PostView {
  id: string;
  author: { id: string; name: string };
  text: string;
  media: { url: string; kind: MediaKind } | null;
  createdAt: number;
  likeCount: number;
  liked: boolean;
  commentCount: number;
  community: { id: string; name: string } | null;
  repost: Omit<PostView, 'repost'> | null;
  canDelete: boolean;
  /** A text post's backdrop; null for media posts and for posts written before Moments. */
  backdrop: Backdrop | null;
  /** Hashtags in the text, lower case, without `#`. */
  tags: string[];
  /** Whether the viewer saved this post. Saves are private: nobody else can see them. */
  saved: boolean;
  /** The Open Feed Charter criteria that placed this post. Empty in feeds that are newest first. */
  because: CriterionId[];
  /** The Nexconn message this post maps to. A mapping only: Nexconn is not connected in this build. */
  nexconn: NexconnRef;
}

export const FEED_SCOPES = ['all', 'following', 'videos', 'latest', 'visual'] as const;
export type FeedScope = (typeof FEED_SCOPES)[number];
/** Feeds ordered by the Open Feed Charter. 'visual' (pictures, videos and backdrops) is the Reels feed. */
export const RANKED_SCOPES: readonly FeedScope[] = ['all', 'visual'];
const FEED_PAGE = 60;

export const FeedQuerySchema = z.object({
  scope: z.enum(FEED_SCOPES).default('all'),
  communityId: id.nullable().default(null),
  authorId: z
    .string()
    .regex(/^u-[a-z0-9-]{1,40}$/)
    .nullable()
    .default(null),
});

/** A post that is a picture, a video or text on a backdrop. */
export function isVisualPost(p: Post): boolean {
  return p.mediaId !== null || (p.backdrop ?? null) !== null;
}

export interface OrderedPost {
  post: Post;
  because: CriterionId[];
}

export function newestFirst(posts: readonly Post[]): OrderedPost[] {
  return [...posts].sort((a, b) => b.createdAt - a.createdAt || compareIds(a.id, b.id)).map((post) => ({ post, because: [] }));
}

/**
 * Orders posts by the Open Feed Charter for this viewer. Only what the charter announces is read: whom the
 * viewer follows, the communities they joined, and each post's author, age, commenters and likes.
 */
export async function charterOrder(ctx: ServiceContext, eventId: string, userId: string, posts: readonly Post[]): Promise<OrderedPost[]> {
  const [following, communities, comments] = await Promise.all([ctx.store.listFollowing(userId), ctx.store.docList('communities', { eventId }), ctx.store.docList('comments', { eventId })]);
  const commenters = new Map<string, string[]>();
  for (const c of comments) commenters.set(c.postId, [...(commenters.get(c.postId) ?? []), c.authorId]);
  const viewer: RankViewer = {
    userId,
    following: new Set(following.map((f) => f.followeeId)),
    communities: new Set(communities.filter((c) => c.memberIds.includes(userId)).map((c) => c.id)),
    now: ctx.now(),
  };
  const byId = new Map(posts.map((p) => [p.id, p]));
  const ranked = rankFeed(
    posts.map((p) => ({ postId: p.id, authorId: p.authorId, createdAt: p.createdAt, communityId: p.communityId, commenterIds: commenters.get(p.id) ?? [], likerIds: p.likes })),
    viewer,
  );
  return ranked.flatMap((r) => {
    const post = byId.get(r.postId);
    return post ? [{ post, because: r.because }] : [];
  });
}

/** Builds the views for posts already chosen and ordered, keeping their order. */
export async function postViews(ctx: ServiceContext, eventId: string, userId: string, items: readonly OrderedPost[]): Promise<PostView[]> {
  const membership = await requireCapability(ctx, eventId, userId, 'event.read');
  const moderator = roleHasCapability(membership.role, 'content.moderate');
  const [comments, communityList, saves] = await Promise.all([
    ctx.store.docList('comments', { eventId }),
    ctx.store.docList('communities', { eventId }),
    ctx.store.docList('savedPosts', { eventId, userId }),
  ]);
  const commentCount = new Map<string, number>();
  for (const c of comments) commentCount.set(c.postId, (commentCount.get(c.postId) ?? 0) + 1);
  const communities = new Map(communityList.map((c) => [c.id, c.name]));
  const saved = new Set(saves.map((s) => s.postId));
  const names = new Map<string, string>();
  const nameOf = async (uid: string) => {
    if (!names.has(uid)) names.set(uid, (await ctx.store.getUser(uid))?.displayName ?? 'Someone');
    return names.get(uid) ?? 'Someone';
  };
  const view = async (p: Post, because: CriterionId[]): Promise<Omit<PostView, 'repost'>> => ({
    id: p.id,
    author: { id: p.authorId, name: await nameOf(p.authorId) },
    text: p.text,
    media: p.mediaId && p.mediaKind ? { url: `/api/events/${eventId}/media/${p.mediaId}`, kind: p.mediaKind } : null,
    createdAt: p.createdAt,
    likeCount: p.likes.length,
    liked: p.likes.includes(userId),
    commentCount: commentCount.get(p.id) ?? 0,
    community: p.communityId && communities.has(p.communityId) ? { id: p.communityId, name: communities.get(p.communityId) ?? '' } : null,
    canDelete: p.authorId === userId || moderator,
    backdrop: p.backdrop ?? null,
    tags: extractTags(p.text),
    saved: saved.has(p.id),
    because,
    nexconn: nexconnRef(postEnvelope(p)),
  });
  const out: PostView[] = [];
  for (const { post, because } of items) {
    const original = post.repostOf ? await ctx.store.docGet('posts', post.repostOf) : null;
    out.push({ ...(await view(post, because)), repost: original && original.eventId === eventId ? await view(original, []) : null });
  }
  return out;
}

export async function listFeed(ctx: ServiceContext, eventId: string, userId: string, query: z.infer<typeof FeedQuerySchema>): Promise<PostView[]> {
  await requireCapability(ctx, eventId, userId, 'event.read');
  let posts = await ctx.store.docList('posts', { eventId });
  if (query.communityId) posts = posts.filter((p) => p.communityId === query.communityId);
  if (query.authorId) posts = posts.filter((p) => p.authorId === query.authorId);
  if (query.scope === 'videos') posts = posts.filter((p) => p.mediaKind === 'VIDEO');
  if (query.scope === 'visual') posts = posts.filter(isVisualPost);
  if (query.scope === 'following') {
    const following = new Set((await ctx.store.listFollowing(userId)).map((f) => f.followeeId));
    posts = posts.filter((p) => p.authorId === userId || following.has(p.authorId));
  }
  const ordered = RANKED_SCOPES.includes(query.scope) ? await charterOrder(ctx, eventId, userId, posts) : newestFirst(posts);
  return postViews(ctx, eventId, userId, ordered.slice(0, FEED_PAGE));
}

export async function listComments(ctx: ServiceContext, eventId: string, userId: string, postId: string) {
  await requireCapability(ctx, eventId, userId, 'event.read');
  const post = await eventPost(ctx, eventId, postId);
  const comments = (await ctx.store.docList('comments', { postId: post.id })).sort((a, b) => a.createdAt - b.createdAt);
  return Promise.all(
    comments.map(async (c) => ({ id: c.id, author: { id: c.authorId, name: (await ctx.store.getUser(c.authorId))?.displayName ?? 'Someone' }, text: c.text, createdAt: c.createdAt })),
  );
}
