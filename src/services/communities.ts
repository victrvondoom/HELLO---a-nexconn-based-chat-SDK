import { z } from 'zod';
import { DomainError } from '../domain/errors';
import { roleHasCapability } from '../domain/permissions';
import type { Community } from '../domain/product';
import { isCountry } from '../lib/geo';
import { requireCapability, type ServiceContext } from './context';
import { deletePost, ID } from './feed';

/** Communities: open groups inside an event. Anyone in the event can see and join one; only members can post in it. */

export const CommunitySchema = z.object({
  name: z.string().trim().min(3).max(60),
  description: z.string().trim().max(300),
  country: z.string().regex(/^\d{3}$/).nullable().default(null),
});

export const CommunityActionSchema = z.object({ action: z.enum(['join', 'leave', 'delete']) });

async function eventCommunity(ctx: ServiceContext, eventId: string, communityId: string): Promise<Community> {
  const community = ID.test(communityId) ? await ctx.store.docGet('communities', communityId) : null;
  if (!community || community.eventId !== eventId) throw new DomainError('NOT_FOUND', 'That community does not exist.');
  return community;
}

export async function createCommunity(ctx: ServiceContext, eventId: string, userId: string, input: z.infer<typeof CommunitySchema>): Promise<Community> {
  await requireCapability(ctx, eventId, userId, 'message.send');
  if (input.country && !isCountry(input.country)) throw new DomainError('VALIDATION_FAILED', 'Choose a country from the list.');
  const existing = await ctx.store.docList('communities', { eventId });
  if (existing.some((c) => c.name.toLowerCase() === input.name.toLowerCase())) throw new DomainError('VALIDATION_FAILED', 'A community with that name already exists.');
  if (existing.filter((c) => c.ownerId === userId).length >= 10) throw new DomainError('VALIDATION_FAILED', 'You can run up to 10 communities.');
  const community: Community = { id: ctx.newId('com'), eventId, ...input, ownerId: userId, memberIds: [userId], createdAt: ctx.now() };
  await ctx.store.docPut('communities', community);
  return community;
}

export interface CommunityView {
  id: string;
  name: string;
  description: string;
  country: string | null;
  members: number;
  joined: boolean;
  owner: { id: string; name: string };
  isOwner: boolean;
  canDelete: boolean;
}

export async function listCommunities(ctx: ServiceContext, eventId: string, userId: string): Promise<CommunityView[]> {
  const membership = await requireCapability(ctx, eventId, userId, 'event.read');
  const moderator = roleHasCapability(membership.role, 'content.moderate');
  const communities = await ctx.store.docList('communities', { eventId });
  const views = await Promise.all(
    communities.map(async (c) => ({
      id: c.id,
      name: c.name,
      description: c.description,
      country: c.country,
      members: c.memberIds.length,
      joined: c.memberIds.includes(userId),
      owner: { id: c.ownerId, name: (await ctx.store.getUser(c.ownerId))?.displayName ?? 'Someone' },
      isOwner: c.ownerId === userId,
      canDelete: c.ownerId === userId || moderator,
    })),
  );
  return views.sort((a, b) => Number(b.joined) - Number(a.joined) || b.members - a.members || a.name.localeCompare(b.name));
}

export async function getCommunity(ctx: ServiceContext, eventId: string, userId: string, communityId: string): Promise<CommunityView> {
  const found = (await listCommunities(ctx, eventId, userId)).find((c) => c.id === communityId);
  if (!found) throw new DomainError('NOT_FOUND', 'That community does not exist.');
  return found;
}

export async function actOnCommunity(ctx: ServiceContext, eventId: string, userId: string, communityId: string, action: 'join' | 'leave' | 'delete'): Promise<void> {
  const membership = await requireCapability(ctx, eventId, userId, action === 'delete' ? 'message.send' : 'event.read');
  const community = await eventCommunity(ctx, eventId, communityId);
  if (action === 'delete') {
    if (community.ownerId !== userId && !roleHasCapability(membership.role, 'content.moderate')) {
      throw new DomainError('FORBIDDEN', 'Only the owner or an organiser can delete a community.');
    }
    for (const post of await ctx.store.docList('posts', { communityId: community.id })) await deletePost(ctx, post);
    await ctx.store.docDelete('communities', community.id);
    return;
  }
  if (action === 'leave' && community.ownerId === userId) throw new DomainError('VALIDATION_FAILED', 'You run this community. Delete it instead of leaving.');
  await ctx.store.docMutate('communities', community.id, (c) => {
    const others = c.memberIds.filter((m) => m !== userId);
    return { ...c, memberIds: action === 'join' ? [...others, userId] : others };
  });
}
