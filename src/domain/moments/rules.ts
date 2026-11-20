import { DomainError, type DomainErrorCode } from '../errors';
import type { MediaKind } from '../product';
import { STORY_TEXT_MAX } from './stories';
import { extractTags, TAG_LIMIT } from './tags';

/**
 * Posting rules for the feed and for stories. Pure rules, no storage, no clock.
 *
 * Every rule has an id that the UI shows next to its text, and a refusal quotes the rule and names its
 * id, so a person can always see which published rule stopped them. There is no other, hidden filter.
 * Feed posts are checked against R1, R2, R3 and R5; stories against R1, R2, R4 and R5.
 */

export const POST_TEXT_MAX = 1000;
export const DUPLICATE_WINDOW_MS = 10 * 60_000;
export const STORY_PACE = { limit: 10, windowMs: 60 * 60_000 } as const;

export const POSTING_RULES = [
  { id: 'R1-length', label: 'Length', rule: `Posts can be up to ${POST_TEXT_MAX} characters, and stories up to ${STORY_TEXT_MAX}.` },
  { id: 'R2-tags', label: 'Hashtags', rule: `Use at most ${TAG_LIMIT} hashtags in a post or story.` },
  { id: 'R3-duplicate', label: 'No repeats', rule: 'You cannot post the same text again within 10 minutes.' },
  { id: 'R4-pace', label: 'Pace', rule: `You can share up to ${STORY_PACE.limit} stories an hour.` },
  {
    id: 'R5-media',
    label: 'Your own media',
    rule: 'Attach only a picture or video you uploaded to this event and have not attached anywhere else. Picture and video stories need a file of that kind.',
  },
] as const;

export type PostingRuleId = (typeof POSTING_RULES)[number]['id'];

/** "<rule text> (rule <id>)": the format every refusal uses. */
export function ruleMessage(id: PostingRuleId): string {
  const rule = POSTING_RULES.find((r) => r.id === id);
  return `${rule?.rule ?? id} (rule ${id})`;
}

export function refuse(id: PostingRuleId, code: DomainErrorCode = 'VALIDATION_FAILED', retryAfterSeconds?: number): DomainError {
  return new DomainError(code, ruleMessage(id), retryAfterSeconds === undefined ? {} : { retryAfterSeconds });
}

/** R1. */
export function tooLong(text: string, kind: 'POST' | 'STORY'): boolean {
  return text.length > (kind === 'POST' ? POST_TEXT_MAX : STORY_TEXT_MAX);
}

/** R2: distinct tags, so repeating one tag is not counted as many. */
export function tooManyTags(text: string): boolean {
  return extractTags(text).length > TAG_LIMIT;
}

/** The text R3 compares: case, spacing and compatibility forms do not make a repeat look new. */
export function duplicateKey(text: string): string {
  return text.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * R3: the same author posting the same text within the window. Empty text (a share, or a picture on its
 * own) is never a repeat, so two shares in a row are allowed.
 */
export function isRepeat(text: string, recent: ReadonlyArray<{ text: string; createdAt: number }>, now: number): boolean {
  const key = duplicateKey(text);
  if (!key) return false;
  return recent.some((p) => now - p.createdAt < DUPLICATE_WINDOW_MS && duplicateKey(p.text) === key);
}

/**
 * R4: counted over the person's own stories, so it holds across restarts and processes, unlike a route
 * limiter. Returns the seconds until the next story is allowed, or null when one is allowed now.
 */
export function paceRetryAfter(storyTimes: readonly number[], now: number): number | null {
  const recent = storyTimes.filter((t) => now - t < STORY_PACE.windowMs).sort((a, b) => a - b);
  if (recent.length < STORY_PACE.limit) return null;
  // The window must lose enough stories to fall below the limit: the one at this index leaves last.
  const unlocks = (recent[recent.length - STORY_PACE.limit] ?? now) + STORY_PACE.windowMs;
  return Math.max(1, Math.ceil((unlocks - now) / 1000));
}

export interface AttachedMedia {
  eventId: string;
  ownerId: string;
  kind: MediaKind;
  /** True when a post or story already carries this file. Deleting one would delete it for the other. */
  inUse: boolean;
}

export type MediaRuleOutcome = 'OK' | 'NOT_YOURS' | 'IN_USE' | 'WRONG_KIND';

/**
 * R5. NOT_YOURS covers a missing file too, so the answer never confirms that someone else's upload exists.
 * `wanted` is the kind a story needs, or ANY for a post.
 */
export function checkAttachment(media: AttachedMedia | null, actor: { eventId: string; userId: string }, wanted: MediaKind | 'ANY'): MediaRuleOutcome {
  if (!media || media.eventId !== actor.eventId || media.ownerId !== actor.userId) return 'NOT_YOURS';
  if (media.inUse) return 'IN_USE';
  if (wanted !== 'ANY' && media.kind !== wanted) return 'WRONG_KIND';
  return 'OK';
}
