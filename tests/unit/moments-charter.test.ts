import { describe, expect, it } from 'vitest';
import { FEED_CRITERIA, NEVER_USED, rankFeed, scorePost, type CriterionId, type RankInput, type RankViewer } from '@/domain/moments/charter';

const NOW = Date.UTC(2026, 10, 10, 12, 0);
const MIN = 60_000;
const PEOPLE = ['u-a', 'u-b', 'u-c', 'u-d', 'u-e', 'u-f'] as const;
const COMMUNITIES = ['com-1', 'com-2', 'com-3'] as const;

/** Mulberry32: a small seeded PRNG, so every "random" case is the same on every run. */
function prng(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rand: () => number, items: readonly T[]): T {
  return items[Math.floor(rand() * items.length)] as T;
}

function shuffle<T>(rand: () => number, items: readonly T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

function randomCase(rand: () => number): { posts: RankInput[]; viewer: RankViewer } {
  const userId = pick(rand, PEOPLE);
  const viewer: RankViewer = {
    userId,
    following: new Set(PEOPLE.filter((p) => p !== userId && rand() < 0.4)),
    communities: new Set(COMMUNITIES.filter(() => rand() < 0.5)),
    now: NOW,
  };
  const count = 1 + Math.floor(rand() * 14);
  const posts = Array.from({ length: count }, (_, i): RankInput => ({
    postId: `pst-${i}`,
    authorId: pick(rand, PEOPLE),
    // Coarse ages make equal scores and equal times common, so the tie-breaks are exercised; some are in the future.
    createdAt: NOW - Math.floor(rand() * 30) * 10 * MIN + (rand() < 0.08 ? 5 * MIN : 0),
    communityId: rand() < 0.4 ? pick(rand, COMMUNITIES) : null,
    commenterIds: PEOPLE.filter(() => rand() < 0.3),
    likerIds: PEOPLE.filter(() => rand() < 0.35),
  }));
  return { posts, viewer };
}

const ANNOUNCED = new Map(FEED_CRITERIA.map((c) => [c.id, c.max]));
const max = (id: CriterionId) => ANNOUNCED.get(id) ?? Number.NaN;

/** The points written in the charter's own words, computed independently of the implementation. */
function announcedPoints(p: RankInput, v: RankViewer): Record<CriterionId, number> {
  const ageMinutes = Math.max(0, (v.now - p.createdAt) / MIN);
  const others = (ids: readonly string[]) => [...new Set(ids)].filter((id) => id !== v.userId && id !== p.authorId);
  return {
    yours: p.authorId === v.userId && ageMinutes <= 15 ? max('yours') : 0,
    following: p.authorId !== v.userId && v.following.has(p.authorId) ? max('following') : 0,
    community: p.communityId !== null && v.communities.has(p.communityId) ? max('community') : 0,
    fresh: Math.max(0, max('fresh') - Math.floor(ageMinutes / 20)),
    conversation: Math.min(max('conversation'), 3 * others(p.commenterIds).length),
    'liked-by-follows': Math.min(max('liked-by-follows'), 5 * others(p.likerIds).filter((id) => v.following.has(id)).length),
  };
}

describe('Open Feed Charter', () => {
  it('announces each criterion once, with the never-used list beside it', () => {
    expect(new Set(FEED_CRITERIA.map((c) => c.id)).size).toBe(FEED_CRITERIA.length);
    expect(FEED_CRITERIA.every((c) => c.label.length > 0 && c.rule.length > 0 && c.max > 0)).toBe(true);
    expect(NEVER_USED).toEqual(['How long anyone looks at a post', 'Where anyone is', 'Private messages', 'Whose profile you opened', 'Paid promotion']);
  });

  it('gives the same order whatever order the posts arrive in (200 seeded cases)', () => {
    const rand = prng(20261110);
    for (let i = 0; i < 200; i += 1) {
      const { posts, viewer } = randomCase(rand);
      const expected = rankFeed(posts, viewer);
      expect(rankFeed(shuffle(rand, posts), viewer)).toEqual(expected);
      expect(rankFeed([...posts].reverse(), viewer)).toEqual(expected);
      expect(expected.map((r) => r.postId).sort()).toEqual(posts.map((p) => p.postId).sort());
    }
  });

  it('scores every post as the sum of the announced points, and cites only announced criteria that gave points', () => {
    const rand = prng(42);
    const announced = new Set<string>(FEED_CRITERIA.map((c) => c.id));
    for (let i = 0; i < 200; i += 1) {
      const { posts, viewer } = randomCase(rand);
      for (const p of posts) {
        const points = announcedPoints(p, viewer);
        const { score, because } = scorePost(p, viewer);
        expect(score).toBe(FEED_CRITERIA.reduce((sum, c) => sum + points[c.id], 0));
        expect(because).toEqual(FEED_CRITERIA.filter((c) => points[c.id] > 0).map((c) => c.id));
        expect(because.every((id) => announced.has(id))).toBe(true);
        expect(score).toBeLessThanOrEqual(FEED_CRITERIA.reduce((sum, c) => sum + c.max, 0));
      }
      // The ranked list is ordered by score, then newest, then id.
      const ranked = rankFeed(posts, viewer);
      const at = new Map(posts.map((p) => [p.postId, p.createdAt]));
      for (let k = 1; k < ranked.length; k += 1) {
        const [a, b] = [ranked[k - 1], ranked[k]];
        if (!a || !b) continue;
        const ordered = a.score > b.score || (a.score === b.score && ((at.get(a.postId) ?? 0) > (at.get(b.postId) ?? 0) || ((at.get(a.postId) ?? 0) === (at.get(b.postId) ?? 0) && a.postId < b.postId)));
        expect(ordered).toBe(true);
      }
    }
  });

  it('never moves a post down when you start following its author', () => {
    const rand = prng(7);
    let checked = 0;
    for (let i = 0; i < 200; i += 1) {
      const { posts, viewer } = randomCase(rand);
      const candidates = PEOPLE.filter((p) => p !== viewer.userId && !viewer.following.has(p));
      if (candidates.length === 0) continue;
      const author = pick(rand, candidates);
      const before = rankFeed(posts, viewer).map((r) => r.postId);
      const after = rankFeed(posts, { ...viewer, following: new Set([...viewer.following, author]) }).map((r) => r.postId);
      for (const p of posts.filter((x) => x.authorId === author)) {
        expect(after.indexOf(p.postId)).toBeLessThanOrEqual(before.indexOf(p.postId));
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(50);
  });

  it('keeps your own post on top for exactly 15 minutes', () => {
    const viewer: RankViewer = { userId: 'u-a', following: new Set(['u-b']), communities: new Set(['com-1']), now: NOW };
    const own = (ageMs: number): RankInput => ({ postId: 'pst-own', authorId: 'u-a', createdAt: NOW - ageMs, communityId: null, commenterIds: [], likerIds: [] });
    expect(scorePost(own(15 * MIN), viewer).because).toContain('yours');
    expect(scorePost(own(15 * MIN + 1), viewer).because).not.toContain('yours');
    // The strongest possible post by someone else (40 + 25 + 30 + 15 + 15) still sits below your fresh post (100 + 30).
    const following = { ...viewer, following: new Set(['u-b', 'u-c', 'u-d', 'u-e']) };
    const top: RankInput = { postId: 'pst-top', authorId: 'u-b', createdAt: NOW, communityId: 'com-1', commenterIds: ['u-c', 'u-d', 'u-e', 'u-f', 'u-g'], likerIds: ['u-c', 'u-d', 'u-e'] };
    expect(scorePost(top, following).score).toBe(125);
    expect(rankFeed([top, own(14 * MIN)], following)[0]?.postId).toBe('pst-own');
  });

  it('does not count the viewer or the author as commenters or likers, and counts each person once', () => {
    const viewer: RankViewer = { userId: 'u-a', following: new Set(['u-b', 'u-c']), communities: new Set(), now: NOW };
    const post: RankInput = { postId: 'pst-1', authorId: 'u-b', createdAt: NOW - 600 * MIN, communityId: null, commenterIds: ['u-a', 'u-b', 'u-c', 'u-c'], likerIds: ['u-a', 'u-b', 'u-c', 'u-c'] };
    const { score, because } = scorePost(post, viewer);
    expect(because).toEqual(['following', 'conversation', 'liked-by-follows']);
    expect(score).toBe(40 + 3 + 5);
  });

  it('loses one fresh point every 20 minutes, never goes below zero, and treats future posts as new', () => {
    const viewer: RankViewer = { userId: 'u-z', following: new Set(), communities: new Set(), now: NOW };
    const at = (ageMs: number) => scorePost({ postId: 'pst-1', authorId: 'u-a', createdAt: NOW - ageMs, communityId: null, commenterIds: [], likerIds: [] }, viewer).score;
    expect(at(0)).toBe(30);
    expect(at(20 * MIN - 1)).toBe(30);
    expect(at(20 * MIN)).toBe(29);
    expect(at(600 * MIN)).toBe(0);
    expect(at(6000 * MIN)).toBe(0);
    expect(at(-5 * MIN)).toBe(30);
  });

  it('breaks ties by age, then by id', () => {
    const viewer: RankViewer = { userId: 'u-z', following: new Set(), communities: new Set(), now: NOW };
    const p = (postId: string, minutes: number): RankInput => ({ postId, authorId: 'u-a', createdAt: NOW - minutes * MIN, communityId: null, commenterIds: [], likerIds: [] });
    // 1 and 5 minutes old score the same (30); the newer is first. Equal ages fall back to the id.
    expect(rankFeed([p('pst-b', 5), p('pst-c', 1), p('pst-a', 5)], viewer).map((r) => r.postId)).toEqual(['pst-c', 'pst-a', 'pst-b']);
  });
});
