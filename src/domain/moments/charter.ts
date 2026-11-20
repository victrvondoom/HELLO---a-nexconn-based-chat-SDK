/**
 * The Open Feed Charter: how the "Everyone" feed is ordered, in full. Pure rules, no storage, no clock.
 *
 * A post's place is decided only by the criteria announced in FEED_CRITERIA, and every post carries the
 * ids of the criteria that placed it (`because`), so "why am I seeing this?" always has a true answer.
 * The inputs are limited to what RankInput and RankViewer hold: who wrote a post, when, in which
 * community, who commented and who liked it, and whom the viewer follows. Anything in NEVER_USED cannot
 * reach the ranking because there is no field to carry it.
 *
 * The order is total (score, then age, then id) and does not depend on the order posts were read from
 * storage, so two people with the same follows and communities see the same feed.
 */

export const FEED_CRITERIA = [
  { id: 'yours', label: 'Your post', rule: 'Your own post from the last 15 minutes stays on top, so you can see it landed.', max: 100 },
  { id: 'following', label: 'You follow them', rule: 'Posts from people you follow get 40 points.', max: 40 },
  { id: 'community', label: 'Your community', rule: 'Posts in a community you joined get 25 points.', max: 25 },
  { id: 'fresh', label: 'Fresh', rule: 'New posts get up to 30 points, one fewer for every 20 minutes of age.', max: 30 },
  { id: 'conversation', label: 'People are talking', rule: '3 points for each different person who commented, up to 15.', max: 15 },
  { id: 'liked-by-follows', label: 'Liked by people you follow', rule: '5 points for each person you follow who liked it, up to 15.', max: 15 },
] as const;

export type CriterionId = (typeof FEED_CRITERIA)[number]['id'];

/** Signals the charter promises never to use. Shown next to the criteria. */
export const NEVER_USED: readonly string[] = ['How long anyone looks at a post', 'Where anyone is', 'Private messages', 'Whose profile you opened', 'Paid promotion'];

/** How long your own post is pinned to the top of your feed. */
export const YOURS_WINDOW_MS = 15 * 60_000;
/** Every this many milliseconds of age costs one "fresh" point. */
export const FRESH_STEP_MS = 20 * 60_000;
export const POINTS_PER_COMMENTER = 3;
export const POINTS_PER_FOLLOWED_LIKE = 5;

// The fixed awards and caps are read from the announced table, so the text and the arithmetic cannot drift apart.
const MAX = Object.fromEntries(FEED_CRITERIA.map((c) => [c.id, c.max])) as Record<CriterionId, number>;

export interface RankInput {
  postId: string;
  authorId: string;
  createdAt: number;
  communityId: string | null;
  commenterIds: readonly string[];
  likerIds: readonly string[];
}

export interface RankViewer {
  userId: string;
  following: ReadonlySet<string>;
  communities: ReadonlySet<string>;
  now: number;
}

export interface RankedPost {
  postId: string;
  score: number;
  because: CriterionId[];
}

/**
 * Points for each criterion. Commenters and likers are counted once each, and never the viewer or the
 * author: commenting on your own post, or liking it yourself, cannot lift it.
 */
export function criterionPoints(p: RankInput, v: RankViewer): Record<CriterionId, number> {
  const age = Math.max(0, v.now - p.createdAt);
  const others = (ids: readonly string[]) => new Set(ids.filter((id) => id !== v.userId && id !== p.authorId));
  const own = p.authorId === v.userId;
  const followedLikers = [...others(p.likerIds)].filter((id) => v.following.has(id)).length;
  return {
    yours: own && age <= YOURS_WINDOW_MS ? MAX.yours : 0,
    // You are not someone you follow, so your own posts never collect these points.
    following: !own && v.following.has(p.authorId) ? MAX.following : 0,
    community: p.communityId !== null && v.communities.has(p.communityId) ? MAX.community : 0,
    fresh: Math.max(0, MAX.fresh - Math.floor(age / FRESH_STEP_MS)),
    conversation: Math.min(MAX.conversation, POINTS_PER_COMMENTER * others(p.commenterIds).size),
    'liked-by-follows': Math.min(MAX['liked-by-follows'], POINTS_PER_FOLLOWED_LIKE * followedLikers),
  };
}

/** The score is the sum of the points; `because` lists every criterion that gave points, in FEED_CRITERIA order. */
export function scorePost(p: RankInput, v: RankViewer): { score: number; because: CriterionId[] } {
  const points = criterionPoints(p, v);
  return {
    score: FEED_CRITERIA.reduce((sum, c) => sum + points[c.id], 0),
    because: FEED_CRITERIA.filter((c) => points[c.id] > 0).map((c) => c.id),
  };
}

/** Code-unit comparison: the same on every machine, unlike localeCompare. */
export function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Highest score first, then newest, then post id. */
export function rankFeed(posts: readonly RankInput[], v: RankViewer): RankedPost[] {
  return posts
    .map((p) => ({ p, ...scorePost(p, v) }))
    .sort((a, b) => b.score - a.score || b.p.createdAt - a.p.createdAt || compareIds(a.p.postId, b.p.postId))
    .map(({ p, score, because }) => ({ postId: p.postId, score, because }));
}
