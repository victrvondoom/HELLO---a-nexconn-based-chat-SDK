import { tokenise } from '../domain/incidents/classify';
import type { Role } from '../domain/types';
import { requireCapability, type ServiceContext } from './context';

/**
 * People discovery.
 *
 * Only people who have set `discoverable: true` appear. Results expose the display
 * name, role and declared interests, never contact details. Every match states the
 * stored interests that caused it, so nothing is inferred from anything else.
 */

export interface PersonMatch {
  userId: string;
  displayName: string;
  role: Role;
  matchedInterests: string[];
  declaredInterests: string[];
  reason: string;
}

export async function discoverPeople(
  ctx: ServiceContext,
  eventId: string,
  viewerUserId: string,
  query: string,
): Promise<PersonMatch[]> {
  await requireCapability(ctx, eventId, viewerUserId, 'people.discover');
  const queryTokens = new Set(tokenise(query));
  if (queryTokens.size === 0) {
    return [];
  }

  const memberships = await ctx.store.listMemberships(eventId);
  const matches: PersonMatch[] = [];

  for (const membership of memberships) {
    if (membership.userId === viewerUserId) continue;
    const user = await ctx.store.getUser(membership.userId);
    if (!user || !user.discoverable) continue;

    const matchedInterests = user.interests.filter((interest) =>
      tokenise(interest).some((token) => queryTokens.has(token)),
    );
    if (matchedInterests.length === 0) continue;

    matches.push({
      userId: user.id,
      displayName: user.displayName,
      role: membership.role,
      matchedInterests,
      declaredInterests: user.interests,
      reason: `Declares interest in ${matchedInterests.join(', ')}.`,
    });
  }

  return matches.sort((a, b) => b.matchedInterests.length - a.matchedInterests.length || a.displayName.localeCompare(b.displayName));
}
