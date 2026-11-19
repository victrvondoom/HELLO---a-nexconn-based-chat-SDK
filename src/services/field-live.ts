import { requireCapability, type ServiceContext } from './context';
import { isOpen } from '../domain/incidents/lifecycle';
import { seasonPulse, spaceCondition, type SeasonPulse, type SpaceCondition } from '../domain/field/live';
import { listMissionsForViewer, playerState, seasonsForViewer, type MissionView, type PlayerState, type SeasonView } from './field-atlas';

/**
 * Live Field Atlas data: field conditions (incidents + occupancy + schedule, per place) and the season pulse.
 * Read on every atlas poll, so the map and Quest Director change as the event changes, with no extra state.
 */

/** Conditions for every place on the venue map that is linked to a room. Places with no room are CLEAR. */
export async function fieldConditions(ctx: ServiceContext, eventId: string, userId: string): Promise<Record<string, SpaceCondition>> {
  await requireCapability(ctx, eventId, userId, 'event.read');
  const [venue, rooms, sessions, incidents] = await Promise.all([
    ctx.store.getVenue(eventId),
    ctx.store.listRooms(eventId),
    ctx.store.listSessions(eventId),
    ctx.store.listIncidents(eventId),
  ]);
  if (!venue) return {};
  const now = ctx.now();
  const out: Record<string, SpaceCondition> = {};
  for (const space of venue.spaces) {
    if (!space.roomId) continue;
    const room = rooms.find((r) => r.id === space.roomId) ?? null;
    const condition = spaceCondition(space.id, {
      incidents: incidents.filter((i) => i.roomId === space.roomId && isOpen(i.status)).map((i) => ({ category: i.category, urgency: i.urgency })),
      room: room ? { capacity: room.capacity, occupancy: room.occupancy, occupancySource: room.occupancySource } : null,
      sessions: sessions.filter((s) => s.roomId === space.roomId).map((s) => ({ id: s.id, title: s.title, startsAt: s.startsAt, endsAt: s.endsAt })),
      now,
    });
    if (condition.signals.length > 0) out[space.id] = condition;
  }
  return out;
}

/** Aggregate, suppressed momentum for the published missions and the current season. */
export async function fieldPulse(ctx: ServiceContext, eventId: string, userId: string, season: SeasonView | null): Promise<SeasonPulse> {
  await requireCapability(ctx, eventId, userId, 'event.read');
  const [missions, attempts, badges] = await Promise.all([
    ctx.store.docList('fieldMissions', { eventId }),
    ctx.store.docList('fieldAttempts', { eventId }),
    season ? ctx.store.docList('fieldBadges', { eventId, seasonId: season.id }) : Promise.resolve([]),
  ]);
  return seasonPulse({
    seasonId: season?.id ?? null,
    seasonMissionIds: season ? season.missions.map((m) => m.id) : [],
    missionIds: missions.filter((m) => m.status === 'PUBLISHED').map((m) => m.id).sort(),
    attempts: attempts.map((a) => ({ missionId: a.missionId, userId: a.userId, status: a.status, startedAt: a.startedAt, approvedAt: a.approvedAt })),
    badgeHolders: new Set(badges.map((b) => b.userId)).size,
    now: ctx.now(),
  });
}

export interface AtlasVenueView {
  name: string;
  width: number;
  depth: number;
  floors: Array<{ id: number; name: string }>;
  spaces: Array<{ id: string; floor: number; name: string; kind: string; outline: Array<readonly [number, number]>; stepFree: boolean; roomId: string | null }>;
}

export interface AtlasHomeData {
  player: PlayerState;
  missions: MissionView[];
  season: SeasonView | null;
  venue: AtlasVenueView | null;
  conditions: Record<string, SpaceCondition>;
  pulse: SeasonPulse;
  serverTime: number;
}

/**
 * The Field Atlas home for one viewer. The page renders it first and the API route serves the same object
 * on every poll. They used to build it separately, so a field added to one could be missing from the other.
 */
export async function atlasHome(ctx: ServiceContext, eventId: string, userId: string): Promise<AtlasHomeData> {
  const [player, missions, seasons, venue, conditions] = await Promise.all([
    playerState(ctx, eventId, userId),
    listMissionsForViewer(ctx, eventId, userId),
    seasonsForViewer(ctx, eventId, userId),
    ctx.store.getVenue(eventId),
    fieldConditions(ctx, eventId, userId),
  ]);
  const pulse = await fieldPulse(ctx, eventId, userId, seasons.current);
  return {
    player,
    missions,
    season: seasons.current,
    venue: venue
      ? {
          name: venue.name,
          width: venue.width,
          depth: venue.depth,
          floors: venue.floors.map((f) => ({ id: f.id, name: f.name })),
          spaces: venue.spaces.map((s) => ({ id: s.id, floor: s.floor, name: s.name, kind: s.kind, outline: s.outline, stepFree: s.stepFree, roomId: s.roomId })),
        }
      : null,
    conditions,
    pulse,
    serverTime: ctx.now(),
  };
}
