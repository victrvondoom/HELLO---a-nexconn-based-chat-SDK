import { has, type Placement, type Schedule, type World } from './world';

/**
 * The Steadfast simulator: s' = F(s, Δ).
 *
 * Applies the fixed operations playbook to schedule `s` under disruption mask `Δ`, then measures a normalised
 * margin for every constraint family. A schedule fails critically when any margin is below zero.
 *
 * Playbook (fixed, documented in docs/HELLO_STEADFAST.md):
 *   1. A session whose room is lost moves to the standby room in the same slot, if the standby room is
 *      available and free. Sessions are handled in (slot, session id) order, so the result is deterministic.
 *   2. Otherwise the session has no room.
 * Nothing else is moved by the playbook. Fixing anything further is the proposer's job, outside F.
 *
 * Deterministic: identical world, schedule and mask always produce identical output. No AI, no clock.
 */

export const CONSTRAINTS = [
  'capacity',
  'room_availability',
  'speaker_overlap',
  'session_overlap',
  'av_capability',
  'accessibility',
  'step_free_route',
  'transition_time',
  'hosting',
] as const;

export type ConstraintFamily = (typeof CONSTRAINTS)[number];

export interface Violation {
  constraint: ConstraintFamily;
  sessionId: string;
  roomId: string | null;
  slot: number;
  margin: number;
  detail: string;
}

export interface SimResult {
  pass: boolean;
  margins: Record<ConstraintFamily, number>;
  violations: Violation[];
  /** Where each session ended up after the playbook. Null: no room. */
  effective: Record<string, Placement | null>;
}

export function simulate(world: World, schedule: Schedule, mask: number): SimResult {
  const rooms = new Map(world.rooms.map((r) => [r.id, r] as const));
  const t = world.targets;
  const lost = new Set<string>();
  if (has(mask, 'primary_room_loss') && t.primaryRoomId) lost.add(t.primaryRoomId);
  const standby = world.rooms.find((r) => r.standby) ?? null;
  const standbyUp = standby !== null && !has(mask, 'standby_room_loss');

  // 1. The playbook.
  const order = world.sessions
    .filter((s) => schedule.placements[s.id])
    .sort((a, b) => (schedule.placements[a.id]?.slot ?? 0) - (schedule.placements[b.id]?.slot ?? 0) || (a.id < b.id ? -1 : 1));
  const effective: Record<string, Placement | null> = {};
  const used = new Set<string>();
  for (const s of order) {
    const p = schedule.placements[s.id] as Placement;
    if (!lost.has(p.roomId) && !(standby && p.roomId === standby.id && !standbyUp)) {
      effective[s.id] = p;
      used.add(`${p.roomId}#${p.slot}`);
    }
  }
  for (const s of order) {
    if (s.id in effective) continue;
    const p = schedule.placements[s.id] as Placement;
    const key = standby ? `${standby.id}#${p.slot}` : '';
    if (standby && standbyUp && !used.has(key)) {
      effective[s.id] = { roomId: standby.id, slot: p.slot };
      used.add(key);
    } else {
      effective[s.id] = null;
    }
  }

  // 2. Margins.
  const margins = Object.fromEntries(CONSTRAINTS.map((c) => [c, 1])) as Record<ConstraintFamily, number>;
  const violations: Violation[] = [];
  const record = (constraint: ConstraintFamily, sessionId: string, at: Placement | null, margin: number, detail: string) => {
    const m = Math.max(-1, Math.min(1, margin));
    if (m < margins[constraint]) margins[constraint] = m;
    if (m < 0) violations.push({ constraint, sessionId, roomId: at?.roomId ?? null, slot: at?.slot ?? schedule.placements[sessionId]?.slot ?? 0, margin: m, detail });
  };

  const cells = new Map<string, string[]>();
  const speakerSlots = new Map<string, Array<{ sessionId: string; slot: number; zone: string }>>();
  for (const s of world.sessions) {
    const at = effective[s.id] ?? null;
    if (!at) {
      record('room_availability', s.id, null, -1, 'No room is available for this session.');
      continue;
    }
    const room = rooms.get(at.roomId);
    if (!room) {
      record('room_availability', s.id, at, -1, 'The assigned room does not exist.');
      continue;
    }
    const key = `${at.roomId}#${at.slot}`;
    cells.set(key, [...(cells.get(key) ?? []), s.id]);

    const expected = has(mask, 'demand_surge') && t.surgeSessionId === s.id ? Math.ceil(s.expected * t.surgeFactor) : s.expected;
    record('capacity', s.id, at, (room.capacity - expected) / room.capacity, `${expected} expected, ${room.capacity} seats.`);

    const av = room.av && !(has(mask, 'av_failure') && t.avRoomId === room.id);
    if (s.needsAv) record('av_capability', s.id, at, av ? 1 : -1, av ? '' : `${room.name} has no working AV.`);

    if (s.needsStepFree) {
      record('accessibility', s.id, at, room.stepFree ? 1 : -1, room.stepFree ? '' : `${room.name} has no step-free entrance.`);
      const routeClosed = has(mask, 'step_free_route_closure') && t.stepFreeZone === room.zone;
      if (room.stepFree) record('step_free_route', s.id, at, routeClosed ? -1 : 1, routeClosed ? `The step-free route to zone ${room.zone} is closed.` : '');
    }

    if (s.speakerId) {
      const delayed = has(mask, 'speaker_delay') && t.delayedSpeakerId === s.speakerId && at.slot < t.delayedUntilSlot;
      const away = has(mask, 'speaker_unavailable') && t.unavailableSpeakerId === s.speakerId && at.slot >= t.unavailableFromSlot;
      record('hosting', s.id, at, delayed || away ? -1 : 1, delayed ? 'The speaker has not arrived yet.' : away ? 'The speaker is not available in this slot.' : '');
      speakerSlots.set(s.speakerId, [...(speakerSlots.get(s.speakerId) ?? []), { sessionId: s.id, slot: at.slot, zone: room.zone }]);
    }
  }

  for (const [key, ids] of cells) {
    if (ids.length > 1) for (const id of ids.slice(1)) record('session_overlap', id, { roomId: key.split('#')[0] ?? '', slot: Number(key.split('#')[1]) }, -1, `Shares a room and slot with ${ids[0]}.`);
  }

  const walk = has(mask, 'inter_zone_transition_increase') ? t.increasedWalkMinutes : t.walkMinutes;
  for (const list of speakerSlots.values()) {
    const sorted = [...list].sort((a, b) => a.slot - b.slot);
    for (let i = 1; i < sorted.length; i += 1) {
      const a = sorted[i - 1];
      const b = sorted[i];
      if (!a || !b) continue;
      if (a.slot === b.slot) record('speaker_overlap', b.sessionId, effective[b.sessionId] ?? null, -1, `The speaker is also presenting ${a.sessionId} in this slot.`);
      else if (b.slot === a.slot + 1 && a.zone !== b.zone) record('transition_time', b.sessionId, effective[b.sessionId] ?? null, (world.gapMinutes - walk) / world.gapMinutes, `${walk} minutes to walk between zones, ${world.gapMinutes} minutes between slots.`);
    }
  }

  return { pass: violations.length === 0, margins, violations, effective };
}
