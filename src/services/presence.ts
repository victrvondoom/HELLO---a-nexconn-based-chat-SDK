import { suppressSmall } from '../domain/privacy';
import { requireCapability, type ServiceContext } from './context';
import { assertConnected } from './private-messages';

/**
 * Presence: who has HELLO open right now.
 *
 * Being online is personal. A person is shown as online by name only to their mutual connections, the same
 * people who can message them. Everyone else sees a count of people online, which is hidden below the
 * privacy minimum, so it can never point at one person.
 */
export interface PresenceView {
  /** Mutual connections who are online now. */
  connectionsOnline: string[];
  /** Everyone online in the event, or null when fewer than the privacy minimum. */
  peopleOnline: number | null;
}

export async function presenceFor(ctx: ServiceContext, eventId: string, viewerId: string, online: ReadonlySet<string>): Promise<PresenceView> {
  await requireCapability(ctx, eventId, viewerId, 'event.read');
  const [following, followers] = await Promise.all([ctx.store.listFollowing(viewerId), ctx.store.listFollowers(viewerId)]);
  const followsMe = new Set(followers.map((f) => f.followerId));
  const connections = new Set(following.map((f) => f.followeeId).filter((id) => followsMe.has(id)));
  return {
    connectionsOnline: [...online].filter((id) => id !== viewerId && connections.has(id)).sort(),
    peopleOnline: suppressSmall(online.size),
  };
}

/** May `from` tell `to` that they are typing? Only in a private thread, so only between mutual connections. */
export async function assertCanSignalTyping(ctx: ServiceContext, eventId: string, from: string, to: string): Promise<void> {
  await assertConnected(ctx, eventId, from, to);
}
