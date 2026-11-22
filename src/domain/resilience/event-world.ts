import type { IncidentCategory, Room, Session } from '../types';
import { makeSchedule, makeWorld, type DisruptionId, type Placement, type Schedule, type World } from './world';

/**
 * Builds a CON-FUZZ world from the live event, keeping the event's own room and session ids, so the simulator,
 * the proposal, the approval and the schedule update all speak about the same records (no copies).
 *
 * Only sessions that have not started are in the world: the past cannot be rescheduled. Slots are the
 * distinct start times of those sessions. Assumptions, stated rather than hidden:
 *   - every talk needs AV (slides); a room has AV when it lists a projector or a screen;
 *   - a session marked accessible needs a step-free room and route; a room's `accessible` is its step-free entrance;
 *   - expected attendance is the enrolment figure;
 *   - a room with no upcoming session is held as the standby room (none: standby_room_loss changes nothing);
 *   - at least 10 minutes separate consecutive slots for a speaker to walk between zones.
 */

export const INCIDENT_DISRUPTION: Record<IncidentCategory, DisruptionId> = {
  AV: 'av_failure',
  CAPACITY: 'demand_surge',
  ACCESSIBILITY: 'step_free_route_closure',
  FACILITIES: 'primary_room_loss',
  SCHEDULE: 'speaker_delay',
  GENERAL: 'primary_room_loss',
};

export interface EventWorld {
  world: World;
  baseline: Schedule;
  /** Start time of each slot, and each session's duration, to turn a placement back into times. */
  slotStarts: number[];
  durations: Record<string, number>;
}

export function worldFromEvent(input: { eventId: string; rooms: Room[]; sessions: Session[]; now: number; incidentRoomId: string | null }): EventWorld {
  const upcoming = input.sessions.filter((s) => s.startsAt > input.now).sort((a, b) => a.startsAt - b.startsAt || (a.id < b.id ? -1 : 1));
  const slotStarts = [...new Set(upcoming.map((s) => s.startsAt))].sort((a, b) => a - b);
  const usedRooms = new Set(upcoming.map((s) => s.roomId));
  const standbyId = input.rooms.filter((r) => !usedRooms.has(r.id)).sort((a, b) => b.capacity - a.capacity)[0]?.id ?? null;
  const rooms = input.rooms.map((r) => ({
    id: r.id,
    name: r.name,
    zone: r.zone,
    capacity: r.capacity,
    av: r.equipment.includes('projector') || r.equipment.includes('screen'),
    stepFree: r.accessible,
    standby: r.id === standbyId,
  }));
  const sessions = upcoming.map((s) => ({ id: s.id, title: s.title, speakerId: s.speakerUserId, expected: s.enrolled, needsAv: true, needsStepFree: s.accessible }));

  const incidentRoom = input.rooms.find((r) => r.id === input.incidentRoomId) ?? null;
  const inRoom = upcoming.filter((s) => s.roomId === incidentRoom?.id);
  const fullest = [...(inRoom.length ? inRoom : upcoming)].sort((a, b) => b.enrolled / b.capacity - a.enrolled / a.capacity)[0] ?? null;
  const speaker = [...inRoom, ...upcoming].find((s) => s.speakerUserId)?.speakerUserId ?? null;

  let gap = 10;
  for (let i = 1; i < slotStarts.length; i += 1) {
    const prevEnd = Math.max(...upcoming.filter((s) => s.startsAt === slotStarts[i - 1]).map((s) => s.endsAt));
    gap = Math.max(gap, Math.round(((slotStarts[i] as number) - prevEnd) / 60000));
  }

  const world = makeWorld({
    id: `event:${input.eventId}`,
    rooms,
    sessions,
    slots: slotStarts.length,
    gapMinutes: gap,
    targets: {
      surgeSessionId: fullest?.id ?? null,
      surgeFactor: 1.5,
      primaryRoomId: incidentRoom?.id ?? null,
      avRoomId: incidentRoom?.id ?? null,
      stepFreeZone: incidentRoom?.zone ?? null,
      delayedSpeakerId: speaker,
      delayedUntilSlot: 1,
      unavailableSpeakerId: speaker,
      unavailableFromSlot: Math.max(1, slotStarts.length - 1),
      walkMinutes: 5,
      increasedWalkMinutes: 15,
    },
  });
  const placements: Record<string, Placement> = {};
  for (const s of upcoming) placements[s.id] = { roomId: s.roomId, slot: slotStarts.indexOf(s.startsAt) };
  return {
    world,
    baseline: makeSchedule(placements),
    slotStarts,
    durations: Object.fromEntries(upcoming.map((s) => [s.id, s.endsAt - s.startsAt])),
  };
}
