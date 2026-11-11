import { z } from 'zod';
import { DomainError } from '../domain/errors';
import type { ProfileVisibility, Role } from '../domain/types';
import { notify, requireCapability, type ServiceContext } from './context';

/**
 * Profiles and the follow graph.
 *
 * Rules that are easy to get wrong, and why:
 * - Follows are global, not per event. The connections people make are why they came, and they
 *   should outlive the event.
 * - A profile marked CONNECTIONS needs a mutual follow. A one-sided follow is not enough, or anyone
 *   could unlock a profile just by following it.
 * - Follower and following lists are visible only to their owner. Other people see counts. A social
 *   graph reveals who knows whom, which is often more sensitive than anything in a profile.
 * - You can follow someone who is discoverable, or someone who already follows you (following back).
 *   Nobody can be reached through the graph who chose not to be found.
 * - Profile text is sealed at rest with the server vault, bound to the person's id.
 */

export const PROFILE_LIMITS = { headline: 120, bio: 600 } as const;

const ProfileTextSchema = z.object({
  headline: z.string().max(PROFILE_LIMITS.headline),
  bio: z.string().max(PROFILE_LIMITS.bio),
});
type ProfileText = z.infer<typeof ProfileTextSchema>;

const EMPTY: ProfileText = { headline: '', bio: '' };
const context = (userId: string) => `profile:${userId}`;

async function readProfile(ctx: ServiceContext, userId: string): Promise<{ text: ProfileText; visibility: ProfileVisibility }> {
  const record = await ctx.store.getProfile(userId);
  if (!record) return { text: EMPTY, visibility: 'EVENT' };
  try {
    const parsed = ProfileTextSchema.safeParse(JSON.parse(ctx.vault.open(record.sealed, context(userId))));
    return { text: parsed.success ? parsed.data : EMPTY, visibility: record.visibility };
  } catch {
    // A value sealed under another key (for example after a restart with an ephemeral key) cannot be read.
    return { text: EMPTY, visibility: record.visibility };
  }
}

export interface Relationship {
  following: boolean;
  followsYou: boolean;
  connected: boolean;
}

async function relationship(ctx: ServiceContext, viewerId: string, targetId: string): Promise<Relationship> {
  const [following, followers] = await Promise.all([ctx.store.listFollowing(viewerId), ctx.store.listFollowers(viewerId)]);
  const isFollowing = following.some((f) => f.followeeId === targetId);
  const followsYou = followers.some((f) => f.followerId === targetId);
  return { following: isFollowing, followsYou, connected: isFollowing && followsYou };
}

export interface ProfileView {
  userId: string;
  displayName: string;
  role: Role;
  isSelf: boolean;
  discoverable: boolean;
  /** Null when the viewer may not see it, with `hiddenReason` saying why. */
  headline: string | null;
  bio: string | null;
  interests: string[];
  hiddenReason: string | null;
  visibility: ProfileVisibility;
  followers: number;
  following: number;
  relationship: Relationship;
  canFollow: boolean;
  /** Direct messages need a mutual connection: it is the cheapest, strongest defence against unwanted contact at events. */
  canMessage: boolean;
}

export async function getProfileView(ctx: ServiceContext, eventId: string, viewerId: string, targetId: string): Promise<ProfileView> {
  await requireCapability(ctx, eventId, viewerId, 'event.read');
  const [membership, user] = await Promise.all([ctx.store.findMembership(eventId, targetId), ctx.store.getUser(targetId)]);
  if (!membership || !user) throw new DomainError('NOT_FOUND', 'That person is not part of this event.');
  const isSelf = viewerId === targetId;
  const rel = isSelf ? { following: false, followsYou: false, connected: false } : await relationship(ctx, viewerId, targetId);
  // Someone who is not discoverable is visible only to themselves and to people they already follow back.
  if (!isSelf && !user.discoverable && !rel.followsYou) {
    throw new DomainError('NOT_FOUND', 'That person is not part of this event.');
  }
  const { text, visibility } = await readProfile(ctx, targetId);
  const [followers, following] = await Promise.all([ctx.store.listFollowers(targetId), ctx.store.listFollowing(targetId)]);
  const allowed = isSelf || visibility === 'EVENT' || (visibility === 'CONNECTIONS' && rel.connected);
  return {
    userId: user.id,
    displayName: user.displayName,
    role: membership.role,
    isSelf,
    discoverable: user.discoverable,
    headline: allowed ? text.headline : null,
    bio: allowed ? text.bio : null,
    interests: isSelf || user.discoverable ? user.interests : [],
    hiddenReason: allowed
      ? null
      : visibility === 'CONNECTIONS'
        ? 'Shared only with mutual connections. Follow each other to see it.'
        : 'This person keeps their profile private.',
    visibility,
    followers: followers.length,
    following: following.length,
    relationship: rel,
    canFollow: !isSelf && (user.discoverable || rel.followsYou),
    canMessage: !isSelf && rel.connected,
  };
}

export async function follow(ctx: ServiceContext, eventId: string, viewerId: string, targetId: string): Promise<Relationship> {
  await requireCapability(ctx, eventId, viewerId, 'event.read');
  if (viewerId === targetId) throw new DomainError('VALIDATION_FAILED', 'You cannot follow yourself.');
  const [membership, user] = await Promise.all([ctx.store.findMembership(eventId, targetId), ctx.store.getUser(targetId)]);
  if (!membership || !user) throw new DomainError('NOT_FOUND', 'That person is not part of this event.');
  const rel = await relationship(ctx, viewerId, targetId);
  if (!user.discoverable && !rel.followsYou) {
    throw new DomainError('NOT_FOUND', 'That person is not part of this event.');
  }
  const created = await ctx.store.addFollow({ followerId: viewerId, followeeId: targetId, createdAt: ctx.now() });
  if (created) {
    const viewer = await ctx.store.getUser(viewerId);
    await notify(ctx, {
      eventId,
      recipientUserId: targetId,
      kind: 'NEW_FOLLOWER',
      body: rel.followsYou ? `${viewer?.displayName ?? 'Someone'} followed you back. You are now connected.` : `${viewer?.displayName ?? 'Someone'} followed you.`,
      href: `/events/${eventId}/people/${viewerId}`,
      dedupeParts: [viewerId],
    });
  }
  return relationship(ctx, viewerId, targetId);
}

export async function unfollow(ctx: ServiceContext, eventId: string, viewerId: string, targetId: string): Promise<Relationship> {
  await requireCapability(ctx, eventId, viewerId, 'event.read');
  await ctx.store.removeFollow(viewerId, targetId);
  return relationship(ctx, viewerId, targetId);
}

export interface NetworkPerson {
  userId: string;
  displayName: string;
  headline: string | null;
  connected: boolean;
}

/** The viewer's own followers and following. Nobody else can list them. */
export async function myNetwork(ctx: ServiceContext, eventId: string, viewerId: string) {
  await requireCapability(ctx, eventId, viewerId, 'event.read');
  const [followers, following] = await Promise.all([ctx.store.listFollowers(viewerId), ctx.store.listFollowing(viewerId)]);
  const followingIds = new Set(following.map((f) => f.followeeId));
  const followerIds = new Set(followers.map((f) => f.followerId));
  const describe = async (id: string): Promise<NetworkPerson | null> => {
    const user = await ctx.store.getUser(id);
    if (!user) return null;
    const connected = followingIds.has(id) && followerIds.has(id);
    const { text, visibility } = await readProfile(ctx, id);
    const visible = visibility === 'EVENT' || (visibility === 'CONNECTIONS' && connected);
    return { userId: id, displayName: user.displayName, headline: visible && text.headline ? text.headline : null, connected };
  };
  const list = async (ids: string[]) => (await Promise.all(ids.map(describe))).filter((p): p is NetworkPerson => p !== null);
  return {
    followers: await list([...followerIds]),
    following: await list([...followingIds]),
  };
}

export const ProfileUpdateSchema = z.object({
  headline: z.string().trim().max(PROFILE_LIMITS.headline),
  bio: z.string().trim().max(PROFILE_LIMITS.bio),
  visibility: z.enum(['EVENT', 'CONNECTIONS', 'ONLY_ME']),
});

export async function updateProfileText(ctx: ServiceContext, userId: string, input: z.infer<typeof ProfileUpdateSchema>): Promise<void> {
  const text: ProfileText = { headline: input.headline, bio: input.bio };
  await ctx.store.putProfile({
    userId,
    sealed: ctx.vault.seal(JSON.stringify(text), context(userId)),
    visibility: input.visibility,
    updatedAt: ctx.now(),
  });
}

export async function ownProfileText(ctx: ServiceContext, userId: string) {
  return readProfile(ctx, userId);
}

export interface DirectoryEntry {
  userId: string;
  displayName: string;
  role: Role;
  headline: string | null;
  interests: string[];
  relationship: Relationship;
}

/** Everyone in the event who chose to be discoverable, with the viewer's relationship to each. */
export async function directory(ctx: ServiceContext, eventId: string, viewerId: string): Promise<DirectoryEntry[]> {
  await requireCapability(ctx, eventId, viewerId, 'people.discover');
  const memberships = await ctx.store.listMemberships(eventId);
  const out: DirectoryEntry[] = [];
  for (const m of memberships) {
    if (m.userId === viewerId) continue;
    const user = await ctx.store.getUser(m.userId);
    if (!user?.discoverable) continue;
    const rel = await relationship(ctx, viewerId, m.userId);
    const { text, visibility } = await readProfile(ctx, m.userId);
    const visible = visibility === 'EVENT' || (visibility === 'CONNECTIONS' && rel.connected);
    out.push({
      userId: user.id,
      displayName: user.displayName,
      role: m.role,
      headline: visible && text.headline ? text.headline : null,
      interests: user.interests,
      relationship: rel,
    });
  }
  return out.sort((a, b) => Number(b.relationship.connected) - Number(a.relationship.connected) || a.displayName.localeCompare(b.displayName));
}
