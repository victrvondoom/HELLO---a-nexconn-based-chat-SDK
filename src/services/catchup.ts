import { catchUpHeadline, catchUpSince } from '../domain/catchup/window';
import { requireCapability, type ServiceContext } from './context';
import { newestFirst, postViews, type PostView } from './feed';
import type { Notification } from '../domain/types';

const CATCHUP_POSTS_MAX = 20;

export interface CatchUp {
  /** Null on a first visit: there is nothing to catch up on yet. */
  since: number | null;
  headline: string;
  posts: PostView[];
  notifications: Notification[];
}

/**
 * Posts by other people and updates addressed to the viewer that arrived after `lastSeen`.
 * Posts go through `postViews`, the same path as the feed, and notifications are the viewer's own.
 */
export async function catchUpFor(ctx: ServiceContext, eventId: string, userId: string, lastSeen: number | null): Promise<CatchUp> {
  await requireCapability(ctx, eventId, userId, 'event.read');
  const since = catchUpSince(lastSeen, ctx.now());
  if (since === null) return { since, headline: 'Welcome. Your catch-up starts after this visit.', posts: [], notifications: [] };
  const [stored, mine] = await Promise.all([ctx.store.docList('posts', { eventId }), ctx.store.listNotifications(userId)]);
  const fresh = stored.filter((p) => p.createdAt > since && p.authorId !== userId);
  const posts = await postViews(ctx, eventId, userId, newestFirst(fresh).slice(0, CATCHUP_POSTS_MAX));
  const notifications = mine.filter((n) => n.eventId === eventId && n.createdAt > since);
  return { since, headline: catchUpHeadline(fresh.length, notifications.length), posts, notifications };
}
