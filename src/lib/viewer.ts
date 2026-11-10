import { notFound, redirect } from 'next/navigation';
import { currentUserId } from './session';
import { getRuntime } from './runtime';
import { roleHasCapability, type Capability } from '@/domain/permissions';
import type { Membership } from '@/domain/types';

/**
 * Loads the viewer for an event page. Redirects to demo sign-in when nobody is signed in,
 * and returns 404 for non-members so the existence of an event is not revealed.
 */
export async function loadEventViewer(eventId: string) {
  const userId = await currentUserId();
  if (!userId) {
    redirect('/demo');
  }
  const runtime = await getRuntime();
  const { store, ctx } = runtime;
  const event = await store.getEvent(eventId);
  const membership: Membership | null = await store.findMembership(eventId, userId);
  if (!event || !membership) {
    notFound();
  }
  const user = await store.getUser(userId);
  return {
    runtime,
    ctx,
    store,
    event,
    membership,
    user,
    userId,
    can: (capability: Capability): boolean => roleHasCapability(membership.role, capability),
  };
}
