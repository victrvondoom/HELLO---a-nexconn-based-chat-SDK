import type { MediaKind, Story, StoryKind } from '../product';
import { compareIds } from './charter';

/**
 * Stories: short posts that last 24 hours. Pure rules, no storage, no clock.
 *
 * - The author can always open their own story, even after it expires, because a story kept in a
 *   highlight outlives the 24 hours. Everyone else sees it only while it is live, and only when the
 *   audience allows: the whole event, or only the author's followers.
 * - A story that expires and is in no highlight is deleted with its media (services/moments.ts), so
 *   "gone after 24 hours" is true of storage, not only of the screen.
 * - The tray is ordered by STORY_ORDER, announced in the same words the code follows. Nothing about
 *   how long anyone watched a story is stored, so nothing like it can be used to order the tray.
 */

export const STORY_TTL_MS = 24 * 60 * 60 * 1000;
export const STORY_TEXT_MAX = 200;
export const HIGHLIGHT_TITLE_MAX = 24;
export const HIGHLIGHT_MAX_STORIES = 30;
/** Highlights are a profile shelf, not storage: a cap keeps one person from pinning every story forever. */
export const HIGHLIGHT_MAX_PER_PERSON = 20;

type Audienced = Pick<Story, 'authorId' | 'audience'>;

export function isExpired(story: Pick<Story, 'expiresAt'>, now: number): boolean {
  return now >= story.expiresAt;
}

/** The audience rule on its own, whatever the story's age. Highlights use it, because they ignore expiry. */
export function audienceAllows(story: Audienced, viewerId: string, followsAuthor: boolean): boolean {
  return story.authorId === viewerId || story.audience === 'EVENT' || followsAuthor;
}

export function canSeeStory(story: Audienced & Pick<Story, 'expiresAt'>, viewerId: string, followsAuthor: boolean, now: number): boolean {
  if (story.authorId === viewerId) return true;
  return !isExpired(story, now) && audienceAllows(story, viewerId, followsAuthor);
}

/** The file a story of this kind must carry: none for a text story. */
export function storyMediaKind(kind: StoryKind): MediaKind | null {
  return kind === 'TEXT' ? null : kind;
}

/** The tray order, in the words shown to people. `orderRings` and `storyPlayOrder` implement exactly this. */
export const STORY_ORDER: readonly string[] = [
  'Your own stories come first.',
  'Then people whose stories you have not seen yet.',
  'Then people you follow.',
  'Then whoever shared most recently.',
  'Anything still tied keeps a fixed order by account id, so the tray never shuffles.',
  'Each person’s stories play oldest first.',
];

export interface RingOrderInput {
  authorId: string;
  hasUnseen: boolean;
  /** Whether the viewer follows the ring's author. */
  followed: boolean;
  /** Newest story in the ring. Null only for the viewer's own empty ring. */
  latestAt: number | null;
}

export function orderRings<T extends RingOrderInput>(rings: readonly T[], viewerId: string): T[] {
  const yours = (r: T) => (r.authorId === viewerId ? 1 : 0);
  return [...rings].sort(
    (a, b) =>
      yours(b) - yours(a) ||
      Number(b.hasUnseen) - Number(a.hasUnseen) ||
      Number(b.followed) - Number(a.followed) ||
      (b.latestAt ?? 0) - (a.latestAt ?? 0) ||
      compareIds(a.authorId, b.authorId),
  );
}

/** Within a ring: oldest first, so a person's stories read in the order they were told. */
export function storyPlayOrder<T extends { id: string; createdAt: number }>(stories: readonly T[]): T[] {
  return [...stories].sort((a, b) => a.createdAt - b.createdAt || compareIds(a.id, b.id));
}
