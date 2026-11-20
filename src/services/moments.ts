import { z } from 'zod';
import { DomainError } from '../domain/errors';
import { roleHasCapability } from '../domain/permissions';
import type { Membership } from '../domain/types';
import { BACKDROPS, REACTION_IDS, type Backdrop, type MediaKind, type ReactionId, type Story, type StoryAudience, type StoryHighlight, type StoryKind } from '../domain/product';
import { compareIds, FEED_CRITERIA, NEVER_USED } from '../domain/moments/charter';
import { paceRetryAfter, POSTING_RULES, refuse, tooLong, tooManyTags } from '../domain/moments/rules';
import {
  audienceAllows,
  canSeeStory,
  HIGHLIGHT_MAX_PER_PERSON,
  HIGHLIGHT_MAX_STORIES,
  HIGHLIGHT_TITLE_MAX,
  isExpired,
  orderRings,
  STORY_ORDER,
  STORY_TEXT_MAX,
  STORY_TTL_MS,
  storyMediaKind,
  storyPlayOrder,
} from '../domain/moments/stories';
import { extractTags, normaliseTag, trendingTags } from '../domain/moments/tags';
import { MOMENT_MESSAGE_TYPES, nexconnRef, storyEnvelope, type NexconnRef } from '../integrations/nexconn/moments';
import { notify, requireCapability, type ServiceContext } from './context';
import { attachable, charterOrder, eventPost, ID, isVisualPost, newestFirst, postViews, type OrderedPost, type PostView } from './feed';

/**
 * Moments: stories, saved posts, highlights and explore, on top of the feed.
 *
 * Rules that are easy to get wrong, and why:
 * - A story that is not visible to someone does not exist for them: every refusal is NOT_FOUND, so a
 *   followers-only story cannot be confirmed by guessing its id. Its file follows it (feed.readMedia).
 * - Only the author learns who watched or reacted. Others get no counts at all, not even zero.
 * - Expired stories are deleted with their files on the next tray read or new story, unless the author
 *   kept them in a highlight. Highlights keep a story's audience, but not its expiry.
 * - Saves are private to the person who saved. Nobody, including the author, can list them.
 * - Nexconn is not connected: `nexconn` on a view is the message it would map to, not a delivery.
 */

const id = z.string().regex(ID);
const OWNER_ID = /^u-[a-z0-9-]{1,40}$/;
const EXPLORE_PAGE = 60;

export const StorySchema = z.object({
  kind: z.enum(['TEXT', 'IMAGE', 'VIDEO']),
  text: z.string().trim().max(STORY_TEXT_MAX).default(''),
  backdrop: z.enum(BACKDROPS).default('meadow'),
  mediaId: id.nullable().default(null),
  spaceId: id.nullable().default(null),
  audience: z.enum(['EVENT', 'FOLLOWERS']).default('EVENT'),
});
export type StoryInput = z.infer<typeof StorySchema>;

export const StoryActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('view') }),
  z.object({ action: z.literal('react'), reactionId: z.enum(REACTION_IDS) }),
  z.object({ action: z.literal('unreact') }),
  z.object({ action: z.literal('delete') }),
]);

export const HighlightSchema = z.object({
  title: z.string().trim().min(1).max(HIGHLIGHT_TITLE_MAX),
  storyIds: z.array(id).min(1).max(HIGHLIGHT_MAX_STORIES),
});

export const HighlightActionSchema = z.object({ action: z.literal('delete') });

export const SaveSchema = z.object({ postId: id, on: z.boolean() });

export interface StoryView {
  id: string;
  author: { id: string; name: string };
  kind: StoryKind;
  text: string;
  backdrop: Backdrop;
  media: { url: string; kind: MediaKind } | null;
  space: { id: string; name: string } | null;
  audience: StoryAudience;
  createdAt: number;
  expiresAt: number;
  /** Your own stories always count as seen. */
  seen: boolean;
  myReaction: ReactionId | null;
  /** For the author only; null for everyone else. */
  viewCount: number | null;
  reactionCount: number | null;
  canDelete: boolean;
  nexconn: NexconnRef;
}

export interface RingView {
  author: { id: string; name: string };
  isYou: boolean;
  hasUnseen: boolean;
  /** Newest story in the ring; null for your own ring when you have no live story. */
  latestAt: number | null;
  /** Oldest first. */
  stories: StoryView[];
}

export interface StoryTray {
  now: number;
  rings: RingView[];
  /** The announced tray order (STORY_ORDER), shown next to the tray. */
  order: readonly string[];
}

export interface StoryViewer {
  user: { id: string; name: string };
  at: number;
  reactionId: ReactionId | null;
}

export interface HighlightView {
  id: string;
  title: string;
  cover: StoryView | null;
  stories: StoryView[];
}

/** What a story view needs to know about the person looking at it. Loaded once per request. */
interface Viewer {
  eventId: string;
  userId: string;
  moderator: boolean;
  following: ReadonlySet<string>;
  spaces: ReadonlyMap<string, string>;
  name: (userId: string) => Promise<string>;
}

async function viewerFor(ctx: ServiceContext, eventId: string, userId: string, membership: Membership): Promise<Viewer> {
  const [following, venue] = await Promise.all([ctx.store.listFollowing(userId), ctx.store.getVenue(eventId)]);
  const names = new Map<string, string>();
  return {
    eventId,
    userId,
    moderator: roleHasCapability(membership.role, 'content.moderate'),
    following: new Set(following.map((f) => f.followeeId)),
    spaces: new Map((venue?.spaces ?? []).map((s) => [s.id, s.name])),
    name: async (uid) => {
      if (!names.has(uid)) names.set(uid, (await ctx.store.getUser(uid))?.displayName ?? 'Someone');
      return names.get(uid) ?? 'Someone';
    },
  };
}

async function storyView(s: Story, v: Viewer): Promise<StoryView> {
  const own = s.authorId === v.userId;
  const mediaKind = storyMediaKind(s.kind);
  return {
    id: s.id,
    author: { id: s.authorId, name: await v.name(s.authorId) },
    kind: s.kind,
    text: s.text,
    backdrop: s.backdrop,
    media: s.mediaId && mediaKind ? { url: `/api/events/${s.eventId}/media/${s.mediaId}`, kind: mediaKind } : null,
    space: s.spaceId && v.spaces.has(s.spaceId) ? { id: s.spaceId, name: v.spaces.get(s.spaceId) ?? '' } : null,
    audience: s.audience,
    createdAt: s.createdAt,
    expiresAt: s.expiresAt,
    seen: own || s.views.some((x) => x.userId === v.userId),
    myReaction: s.reactions.find((r) => r.userId === v.userId)?.reactionId ?? null,
    viewCount: own ? s.views.length : null,
    reactionCount: own ? s.reactions.length : null,
    canDelete: own || v.moderator,
    nexconn: nexconnRef(storyEnvelope(s)),
  };
}

async function isHighlighted(ctx: ServiceContext, story: Story): Promise<boolean> {
  const highlights = await ctx.store.docList('storyHighlights', { eventId: story.eventId, ownerId: story.authorId });
  return highlights.some((h) => h.storyIds.includes(story.id));
}

/** A story this viewer may open: live and in its audience, or kept in a highlight and in its audience. */
async function visibleStory(ctx: ServiceContext, eventId: string, v: Viewer, storyId: string): Promise<Story> {
  const story = ID.test(storyId) ? await ctx.store.docGet('stories', storyId) : null;
  const follows = story ? v.following.has(story.authorId) : false;
  const visible =
    story !== null &&
    story.eventId === eventId &&
    (canSeeStory(story, v.userId, follows, ctx.now()) || (audienceAllows(story, v.userId, follows) && (await isHighlighted(ctx, story))));
  if (!story || !visible) throw new DomainError('NOT_FOUND', 'That story does not exist.');
  return story;
}

/** Deletes a story, its file, and its place in the author's highlights. A highlight left empty goes too. */
export async function deleteStory(ctx: ServiceContext, story: Story): Promise<void> {
  await ctx.store.docDelete('stories', story.id);
  if (story.mediaId) {
    await ctx.store.docDelete('media', story.mediaId);
    await ctx.store.blobDelete(story.mediaId);
  }
  for (const h of await ctx.store.docList('storyHighlights', { eventId: story.eventId, ownerId: story.authorId })) {
    if (!h.storyIds.includes(story.id)) continue;
    const left = await ctx.store.docMutate('storyHighlights', h.id, (x) => ({ ...x, storyIds: x.storyIds.filter((s) => s !== story.id), updatedAt: ctx.now() }));
    if (left && left.storyIds.length === 0) await ctx.store.docDelete('storyHighlights', h.id);
  }
}

/**
 * Deletes every story past its 24 hours that is in no highlight, with its file. Returns how many went.
 * Runs before a tray is read and before a story is posted, so an expired story is gone from storage,
 * not only hidden. Internal: callers have already checked the caller's permission.
 */
export async function purgeExpiredStories(ctx: ServiceContext, eventId: string): Promise<number> {
  const now = ctx.now();
  const kept = new Set((await ctx.store.docList('storyHighlights', { eventId })).flatMap((h) => h.storyIds));
  let removed = 0;
  for (const story of await ctx.store.docList('stories', { eventId })) {
    if (!isExpired(story, now) || kept.has(story.id)) continue;
    await deleteStory(ctx, story);
    removed += 1;
  }
  return removed;
}

export async function createStory(ctx: ServiceContext, eventId: string, userId: string, input: StoryInput): Promise<Story> {
  await requireCapability(ctx, eventId, userId, 'message.send');
  await purgeExpiredStories(ctx, eventId);
  const now = ctx.now();
  if (input.kind === 'TEXT' && input.text.length === 0) throw new DomainError('VALIDATION_FAILED', 'Write something for a text story.');
  if (tooLong(input.text, 'STORY')) throw refuse('R1-length');
  if (tooManyTags(input.text)) throw refuse('R2-tags');
  const wait = paceRetryAfter((await ctx.store.docList('stories', { eventId, authorId: userId })).map((s) => s.createdAt), now);
  if (wait !== null) throw refuse('R4-pace', 'RATE_LIMITED', wait);
  const wanted = storyMediaKind(input.kind);
  // A text story carries no file; a picture or video story needs one of that kind.
  if ((wanted === null) !== (input.mediaId === null)) throw refuse('R5-media');
  if (wanted && input.mediaId) await attachable(ctx, eventId, userId, input.mediaId, wanted);
  if (input.spaceId) {
    const venue = await ctx.store.getVenue(eventId);
    if (!venue?.spaces.some((s) => s.id === input.spaceId)) throw new DomainError('NOT_FOUND', 'That place is not on the venue map.');
  }
  const story: Story = {
    id: ctx.newId('sty'),
    eventId,
    authorId: userId,
    kind: input.kind,
    text: input.text,
    backdrop: input.backdrop,
    mediaId: input.mediaId,
    spaceId: input.spaceId,
    audience: input.audience,
    createdAt: now,
    expiresAt: now + STORY_TTL_MS,
    views: [],
    reactions: [],
  };
  await ctx.store.docPut('stories', story);
  return story;
}

export async function storyTray(ctx: ServiceContext, eventId: string, userId: string): Promise<StoryTray> {
  const membership = await requireCapability(ctx, eventId, userId, 'event.read');
  await purgeExpiredStories(ctx, eventId);
  const now = ctx.now();
  const v = await viewerFor(ctx, eventId, userId, membership);
  // The tray shows live stories only, the author's too: an expired story kept in a highlight lives on the profile.
  const live = (await ctx.store.docList('stories', { eventId })).filter((s) => !isExpired(s, now) && canSeeStory(s, userId, v.following.has(s.authorId), now));
  const byAuthor = new Map<string, Story[]>([[userId, []]]);
  for (const s of live) byAuthor.set(s.authorId, [...(byAuthor.get(s.authorId) ?? []), s]);
  const rings: Array<{ authorId: string; hasUnseen: boolean; followed: boolean; latestAt: number | null; view: RingView }> = [];
  for (const [authorId, list] of byAuthor) {
    const stories: StoryView[] = [];
    for (const s of storyPlayOrder(list)) stories.push(await storyView(s, v));
    const hasUnseen = stories.some((s) => !s.seen);
    const latestAt = list.length > 0 ? Math.max(...list.map((s) => s.createdAt)) : null;
    rings.push({
      authorId,
      hasUnseen,
      followed: v.following.has(authorId),
      latestAt,
      view: { author: { id: authorId, name: await v.name(authorId) }, isYou: authorId === userId, hasUnseen, latestAt, stories },
    });
  }
  return { now, rings: orderRings(rings, userId).map((r) => r.view), order: STORY_ORDER };
}

export async function actOnStory(ctx: ServiceContext, eventId: string, userId: string, storyId: string, input: z.infer<typeof StoryActionSchema>): Promise<StoryView | null> {
  const membership = await requireCapability(ctx, eventId, userId, input.action === 'delete' ? 'message.send' : 'event.read');
  const v = await viewerFor(ctx, eventId, userId, membership);
  const story = await visibleStory(ctx, eventId, v, storyId);
  const own = story.authorId === userId;
  const now = ctx.now();
  const seen = (s: Story) => s.views.some((x) => x.userId === userId);
  if (input.action === 'delete') {
    if (!own && !v.moderator) throw new DomainError('FORBIDDEN', 'Only the author or an organiser can delete a story.');
    await deleteStory(ctx, story);
    return null;
  }
  if (input.action === 'view') {
    // The first view is kept, so watching again changes nothing. The author's own views are not counted.
    if (!own) await ctx.store.docMutate('stories', story.id, (s) => (seen(s) ? null : { ...s, views: [...s.views, { userId, at: now }] }));
  } else if (input.action === 'react') {
    if (own) throw new DomainError('VALIDATION_FAILED', 'You cannot react to your own story.');
    const reactionId = input.reactionId;
    // One reaction per person: a new one replaces the old. Reacting means the story was seen.
    await ctx.store.docMutate('stories', story.id, (s) => ({
      ...s,
      views: seen(s) ? s.views : [...s.views, { userId, at: now }],
      reactions: [...s.reactions.filter((r) => r.userId !== userId), { userId, reactionId, at: now }],
    }));
    await notify(ctx, {
      eventId,
      recipientUserId: story.authorId,
      kind: 'STORY_REACTION',
      body: `${await v.name(userId)} reacted to your story.`,
      href: `/events/${eventId}/feed`,
      dedupeParts: [story.id, userId],
    });
  } else {
    await ctx.store.docMutate('stories', story.id, (s) => (s.reactions.some((r) => r.userId === userId) ? { ...s, reactions: s.reactions.filter((r) => r.userId !== userId) } : null));
  }
  const current = await ctx.store.docGet('stories', story.id);
  return current ? storyView(current, v) : null;
}

/** Who watched a story, newest first, with their reaction. The author only: for anyone else the list does not exist. */
export async function storyViewers(ctx: ServiceContext, eventId: string, userId: string, storyId: string): Promise<StoryViewer[]> {
  await requireCapability(ctx, eventId, userId, 'event.read');
  const story = ID.test(storyId) ? await ctx.store.docGet('stories', storyId) : null;
  if (!story || story.eventId !== eventId || story.authorId !== userId) throw new DomainError('NOT_FOUND', 'That story does not exist.');
  const views = [...story.views].sort((a, b) => b.at - a.at || compareIds(a.userId, b.userId));
  const out: StoryViewer[] = [];
  for (const x of views) {
    out.push({
      user: { id: x.userId, name: (await ctx.store.getUser(x.userId))?.displayName ?? 'Someone' },
      at: x.at,
      reactionId: story.reactions.find((r) => r.userId === x.userId)?.reactionId ?? null,
    });
  }
  return out;
}

export async function createHighlight(ctx: ServiceContext, eventId: string, userId: string, input: z.infer<typeof HighlightSchema>): Promise<StoryHighlight> {
  await requireCapability(ctx, eventId, userId, 'message.send');
  // Purge first: an expired story that is in no highlight is already gone, and cannot be rescued into one.
  await purgeExpiredStories(ctx, eventId);
  const title = input.title.trim();
  const ids = [...new Set(input.storyIds)];
  if (title.length === 0 || title.length > HIGHLIGHT_TITLE_MAX) throw new DomainError('VALIDATION_FAILED', `Give the highlight a title of up to ${HIGHLIGHT_TITLE_MAX} characters.`);
  if (ids.length === 0 || ids.length > HIGHLIGHT_MAX_STORIES) throw new DomainError('VALIDATION_FAILED', `A highlight holds 1 to ${HIGHLIGHT_MAX_STORIES} stories.`);
  const stories: Story[] = [];
  for (const storyId of ids) {
    const story = ID.test(storyId) ? await ctx.store.docGet('stories', storyId) : null;
    if (!story || story.eventId !== eventId || story.authorId !== userId) throw new DomainError('NOT_FOUND', 'That story does not exist.');
    stories.push(story);
  }
  if ((await ctx.store.docList('storyHighlights', { eventId, ownerId: userId })).length >= HIGHLIGHT_MAX_PER_PERSON) {
    throw new DomainError('VALIDATION_FAILED', `You can keep up to ${HIGHLIGHT_MAX_PER_PERSON} highlights.`);
  }
  const now = ctx.now();
  const highlight: StoryHighlight = { id: ctx.newId('hlt'), eventId, ownerId: userId, title, storyIds: storyPlayOrder(stories).map((s) => s.id), createdAt: now, updatedAt: now };
  await ctx.store.docPut('storyHighlights', highlight);
  return highlight;
}

export async function deleteHighlight(ctx: ServiceContext, eventId: string, userId: string, highlightId: string): Promise<void> {
  const membership = await requireCapability(ctx, eventId, userId, 'message.send');
  const highlight = ID.test(highlightId) ? await ctx.store.docGet('storyHighlights', highlightId) : null;
  if (!highlight || highlight.eventId !== eventId) throw new DomainError('NOT_FOUND', 'That highlight does not exist.');
  if (highlight.ownerId !== userId && !roleHasCapability(membership.role, 'content.moderate')) {
    throw new DomainError('FORBIDDEN', 'Only the owner or an organiser can delete a highlight.');
  }
  // Its expired stories lose their protection and go at the next purge.
  await ctx.store.docDelete('storyHighlights', highlight.id);
}

/**
 * A person's highlights as this viewer may see them. A highlighted story keeps its audience after it
 * expires; a highlight with nothing the viewer may see is left out, so its title does not leak either.
 */
export async function listHighlights(ctx: ServiceContext, eventId: string, viewerId: string, ownerId: string): Promise<HighlightView[]> {
  const membership = await requireCapability(ctx, eventId, viewerId, 'event.read');
  if (!OWNER_ID.test(ownerId) || !(await ctx.store.findMembership(eventId, ownerId))) throw new DomainError('NOT_FOUND', 'That person is not part of this event.');
  const v = await viewerFor(ctx, eventId, viewerId, membership);
  const follows = v.following.has(ownerId);
  const highlights = (await ctx.store.docList('storyHighlights', { eventId, ownerId })).sort((a, b) => b.createdAt - a.createdAt || compareIds(a.id, b.id));
  const out: HighlightView[] = [];
  for (const h of highlights) {
    const stories: StoryView[] = [];
    for (const storyId of h.storyIds) {
      const s = await ctx.store.docGet('stories', storyId);
      if (s && s.eventId === eventId && audienceAllows(s, viewerId, follows)) stories.push(await storyView(s, v));
    }
    if (stories.length > 0 || ownerId === viewerId) out.push({ id: h.id, title: h.title, cover: stories[0] ?? null, stories });
  }
  return out;
}

export async function setSaved(ctx: ServiceContext, eventId: string, userId: string, postId: string, on: boolean): Promise<{ saved: boolean }> {
  await requireCapability(ctx, eventId, userId, 'event.read');
  const post = await eventPost(ctx, eventId, postId);
  const saveId = `${userId}:${post.id}`;
  // The id is the pair, so a double tap stores one save and unsaving twice is harmless.
  if (on) await ctx.store.docPutIfAbsent('savedPosts', { id: saveId, eventId, userId, postId: post.id, createdAt: ctx.now() });
  else await ctx.store.docDelete('savedPosts', saveId);
  return { saved: on };
}

/** The viewer's saved posts, most recently saved first. */
export async function listSaved(ctx: ServiceContext, eventId: string, userId: string): Promise<PostView[]> {
  await requireCapability(ctx, eventId, userId, 'event.read');
  const saves = (await ctx.store.docList('savedPosts', { eventId, userId })).sort((a, b) => b.createdAt - a.createdAt || compareIds(a.id, b.id));
  const items: OrderedPost[] = [];
  for (const s of saves) {
    const post = await ctx.store.docGet('posts', s.postId);
    if (post && post.eventId === eventId) items.push({ post, because: [] });
  }
  return postViews(ctx, eventId, userId, items);
}

export interface ExploreResult {
  now: number;
  /** The tag the posts are filtered by, normalised; null for the explore grid. */
  tag: string | null;
  tags: Array<{ tag: string; people: number }>;
  posts: PostView[];
}

/**
 * Without a tag: original visual posts (a picture, a video or text on a backdrop), ordered by the Open Feed
 * Charter for this viewer. With a tag: every post carrying it, text-only ones included, newest first.
 */
export async function explore(ctx: ServiceContext, eventId: string, userId: string, query: { tag: string | null }): Promise<ExploreResult> {
  await requireCapability(ctx, eventId, userId, 'event.read');
  const tag = query.tag === null ? null : normaliseTag(query.tag);
  if (query.tag !== null && tag === null) throw new DomainError('VALIDATION_FAILED', 'A hashtag is 2 to 30 letters, digits or underscores, with at least one letter.');
  const now = ctx.now();
  const posts = await ctx.store.docList('posts', { eventId });
  const ordered = tag
    ? newestFirst(posts.filter((p) => extractTags(p.text).includes(tag)))
    : await charterOrder(
        ctx,
        eventId,
        userId,
        posts.filter((p) => isVisualPost(p) && p.repostOf === null),
      );
  return { now, tag, tags: trendingTags(posts, now), posts: await postViews(ctx, eventId, userId, ordered.slice(0, EXPLORE_PAGE)) };
}

/** Everything that decides what people see in Moments, in the words the code follows. Public within the event. */
export async function momentsCharter(ctx: ServiceContext, eventId: string, userId: string) {
  await requireCapability(ctx, eventId, userId, 'event.read');
  return {
    criteria: FEED_CRITERIA,
    neverUsed: NEVER_USED,
    storyOrder: STORY_ORDER,
    postingRules: POSTING_RULES,
    nexconnTypes: MOMENT_MESSAGE_TYPES,
    nexconnNote: 'Nexconn is not connected in this build. These are the message types Moments would register with it; nothing is sent through Nexconn.',
  };
}
