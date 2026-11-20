import { compareIds } from './charter';

/**
 * Hashtags and what is trending. Pure rules, no storage, no clock.
 *
 * A tag is `#` followed by 2 to 30 letters, digits or underscores, with at least one letter: "Room #12"
 * or "issue #42" are not tags. Tags are compared in lower case after Unicode compatibility folding, so
 * #Robotics, #robotics and a full-width ＃ｒｏｂｏｔｉｃｓ are one tag.
 *
 * Trending counts people, not posts: one person posting a tag twenty times counts once, and a tag
 * trends only when TRENDING_MIN_PEOPLE different people used it, so no trending tag points at one person.
 */

export const TAG_LIMIT = 10;
export const TRENDING_MIN_PEOPLE = 3;
export const TRENDING_WINDOW_MS = 24 * 60 * 60 * 1000;
export const TRENDING_MAX = 12;

// Not after a letter, digit, underscore, `&` (an HTML entity such as &#39;) or another `#`. Combining marks
// (\p{M}) belong to the letters they follow, or tags in scripts such as Devanagari would be cut in half.
const TAG = /(?<![\p{L}\p{M}\p{N}_&#])#(?=[\p{M}\p{N}_]*\p{L})([\p{L}\p{M}\p{N}_]{2,30})(?![\p{L}\p{M}\p{N}_])/gu;
const TAG_ONLY = /^(?=[\p{M}\p{N}_]*\p{L})[\p{L}\p{M}\p{N}_]{2,30}$/u;

/** Unique tags in order of first appearance, lower case, without the `#`. */
export function extractTags(text: string): string[] {
  const out: string[] = [];
  for (const match of text.normalize('NFKC').matchAll(TAG)) {
    const tag = (match[1] ?? '').toLowerCase();
    if (tag && !out.includes(tag)) out.push(tag);
  }
  return out;
}

/** A tag typed into a search or a link (with or without `#`), as stored; null when it is not a tag. */
export function normaliseTag(input: string): string | null {
  const tag = input.normalize('NFKC').trim().replace(/^#/, '').toLowerCase();
  return TAG_ONLY.test(tag) ? tag : null;
}

export interface TaggedPost {
  authorId: string;
  text: string;
  createdAt: number;
}

/** Tags used by at least TRENDING_MIN_PEOPLE different people in the window: most people first, then by name. */
export function trendingTags(posts: readonly TaggedPost[], now: number, windowMs: number = TRENDING_WINDOW_MS): Array<{ tag: string; people: number }> {
  const people = new Map<string, Set<string>>();
  for (const p of posts) {
    if (p.createdAt > now || now - p.createdAt > windowMs) continue;
    for (const tag of extractTags(p.text)) {
      const authors = people.get(tag) ?? new Set<string>();
      authors.add(p.authorId);
      people.set(tag, authors);
    }
  }
  return [...people]
    .map(([tag, authors]) => ({ tag, people: authors.size }))
    .filter((t) => t.people >= TRENDING_MIN_PEOPLE)
    .sort((a, b) => b.people - a.people || compareIds(a.tag, b.tag))
    .slice(0, TRENDING_MAX);
}
