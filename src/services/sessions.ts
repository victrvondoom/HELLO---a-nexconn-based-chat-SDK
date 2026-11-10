import { DomainError } from '../domain/errors';
import { recommendSessions, type RecommendationResult } from '../domain/sessions/recommend';
import type { Room, Session } from '../domain/types';
import { requireCapability, type ServiceContext } from './context';

import { DATA_SOURCE_LABEL } from '../domain/labels';
export { DATA_SOURCE_LABEL };

export interface RoomOverview {
  room: Room;
  occupancyLabel: string;
  overCapacity: boolean;
  /** Only verified or administrator-entered occupancy can show an "over capacity" warning. */
  overCapacityIsVerified: boolean;
  sessionsToday: Session[];
  openIncidentCount: number;
}

/**
 * Walking time between two zones, in minutes. The demo venue uses two rough
 * values. A real venue would supply a measured routing table.
 */
export function demoWalkMinutes(from: string, to: string): number | null {
  if (from === to) return 2;
  return 6;
}

export async function getOperationsOverview(
  ctx: ServiceContext,
  eventId: string,
  userId: string,
): Promise<RoomOverview[]> {
  await requireCapability(ctx, eventId, userId, 'incident.read.operational');
  const rooms = await ctx.store.listRooms(eventId);
  const sessions = await ctx.store.listSessions(eventId);
  const incidents = await ctx.store.listIncidents(eventId);
  return rooms.map((room) => {
    const overCapacity = room.occupancy !== null && room.occupancy > room.capacity;
    const verifiedSource = room.occupancySource === 'LIVE_VERIFIED' || room.occupancySource === 'ADMIN_ENTERED';
    return {
      room,
      occupancyLabel:
        room.occupancy === null || room.occupancySource === null
          ? 'No occupancy data'
          : `${room.occupancy} / ${room.capacity} (${DATA_SOURCE_LABEL[room.occupancySource]})`,
      overCapacity,
      overCapacityIsVerified: overCapacity && verifiedSource,
      sessionsToday: sessions.filter((s) => s.roomId === room.id),
      openIncidentCount: incidents.filter(
        (i) => i.roomId === room.id && !['CLOSED', 'CANCELLED', 'CONFIRMED'].includes(i.status),
      ).length,
    };
  });
}

/**
 * Alternative sessions for a person. The current session is excluded, and everything
 * else is scored with the configured weights. Accessibility needs are read from the person's profile.
 */
export async function recommendAlternatives(
  ctx: ServiceContext,
  eventId: string,
  userId: string,
  currentSessionId: string | null,
): Promise<RecommendationResult> {
  await requireCapability(ctx, eventId, userId, 'session.discover');
  const user = await ctx.store.getUser(userId);
  if (!user) {
    throw new DomainError('NOT_FOUND', 'User not found.');
  }
  const sessions = await ctx.store.listSessions(eventId);
  const rooms = await ctx.store.listRooms(eventId);
  const current = currentSessionId ? sessions.find((s) => s.id === currentSessionId) ?? null : null;
  const currentRoom = current ? rooms.find((r) => r.id === current.roomId) ?? null : null;

  return recommendSessions({
    user,
    sessions,
    rooms,
    // The personal schedule planner is not built yet. The only session treated as planned is the current one.
    plannedSessions: current ? [current] : [],
    currentSessionId,
    now: ctx.now(),
    fromZone: currentRoom?.zone ?? null,
    walkMinutes: demoWalkMinutes,
    maxResults: 3,
  });
}
