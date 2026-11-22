/**
 * CON-FUZZ: conference resilience verification. Worlds and schedules.
 *
 * A world is a bounded, versioned description of a venue and a programme, plus the eight atomic disruptions
 * HELLO v1 models. A disruption set is an 8-bit mask, so a world has exactly 2^8 = 256 disruption subsets.
 * Everything here is pure data: no clock, no storage, no AI.
 */

export const DISRUPTIONS = [
  'demand_surge',
  'primary_room_loss',
  'standby_room_loss',
  'step_free_route_closure',
  'av_failure',
  'speaker_delay',
  'speaker_unavailable',
  'inter_zone_transition_increase',
] as const;

export type DisruptionId = (typeof DISRUPTIONS)[number];
export const SUBSET_COUNT = 1 << DISRUPTIONS.length; // 256
export const FULL_MASK = SUBSET_COUNT - 1;

export const DISRUPTION_LABEL: Record<DisruptionId, string> = {
  demand_surge: 'Demand surge',
  primary_room_loss: 'Primary room lost',
  standby_room_loss: 'Standby room lost',
  step_free_route_closure: 'Step-free route closed',
  av_failure: 'AV failure',
  speaker_delay: 'Speaker delayed',
  speaker_unavailable: 'Speaker unavailable',
  inter_zone_transition_increase: 'Longer walk between zones',
};

export interface WorldRoom {
  id: string;
  name: string;
  zone: string;
  capacity: number;
  /** Projector or screen available. */
  av: boolean;
  /** Step-free entrance. */
  stepFree: boolean;
  /** Held empty so the playbook can move a session into it. */
  standby: boolean;
}

export interface WorldSession {
  id: string;
  title: string;
  speakerId: string | null;
  expected: number;
  needsAv: boolean;
  needsStepFree: boolean;
}

/** What each disruption acts on. Fixed per world version, so a mask means the same thing every time. */
export interface DisruptionTargets {
  surgeSessionId: string | null;
  surgeFactor: number;
  primaryRoomId: string | null;
  avRoomId: string | null;
  stepFreeZone: string | null;
  delayedSpeakerId: string | null;
  /** A delayed speaker cannot present before this slot. */
  delayedUntilSlot: number;
  unavailableSpeakerId: string | null;
  /** An unavailable speaker cannot present in this slot or later. */
  unavailableFromSlot: number;
  walkMinutes: number;
  increasedWalkMinutes: number;
}

export interface World {
  id: string;
  /** Changing anything in the world changes this. Results are only comparable within one version. */
  version: string;
  rooms: WorldRoom[];
  sessions: WorldSession[];
  slots: number;
  /** Minutes between the end of one slot and the start of the next. */
  gapMinutes: number;
  targets: DisruptionTargets;
}

export interface Placement {
  roomId: string;
  slot: number;
}

export interface Schedule {
  version: string;
  placements: Record<string, Placement>;
}

export function maskOf(ids: readonly DisruptionId[]): number {
  return ids.reduce((m, id) => m | (1 << DISRUPTIONS.indexOf(id)), 0);
}

export function idsOf(mask: number): DisruptionId[] {
  return DISRUPTIONS.filter((_, i) => (mask & (1 << i)) !== 0);
}

export function has(mask: number, id: DisruptionId): boolean {
  return (mask & (1 << DISRUPTIONS.indexOf(id))) !== 0;
}

export function popcount(mask: number): number {
  let n = 0;
  for (let m = mask; m; m &= m - 1) n += 1;
  return n;
}

/** FNV-1a over a canonical string: stable across runs and machines, so versions can be compared. */
export function digest(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export function scheduleVersion(placements: Record<string, Placement>): string {
  const canonical = Object.keys(placements)
    .sort()
    .map((id) => `${id}@${placements[id]?.roomId}#${placements[id]?.slot}`)
    .join('|');
  return `sch-${digest(canonical)}`;
}

export function makeSchedule(placements: Record<string, Placement>): Schedule {
  return { version: scheduleVersion(placements), placements };
}

function worldVersion(world: Omit<World, 'version'>): string {
  return `w-${digest(JSON.stringify(world))}`;
}

export function makeWorld(input: Omit<World, 'version'> & { version?: string }): World {
  // The version is derived from everything else, so any version passed in is dropped first.
  const world: Omit<World, 'version'> & { version?: string } = { ...input };
  delete world.version;
  return { ...world, version: worldVersion(world) };
}

/**
 * HELLO v1 benchmark world: 12 sessions, 5 normal rooms, 1 standby room, 4 slots, 2 zones, 8 disruptions.
 * These are benchmark assumptions, not a real venue. Results are reported for this version only.
 */
export function benchmarkWorldV1(): { world: World; baseline: Schedule } {
  const rooms: WorldRoom[] = [
    { id: 'A1', name: 'Main Hall', zone: 'A', capacity: 300, av: true, stepFree: true, standby: false },
    { id: 'A2', name: 'Room 2', zone: 'A', capacity: 70, av: true, stepFree: false, standby: false },
    { id: 'A3', name: 'Room 3', zone: 'A', capacity: 70, av: true, stepFree: true, standby: false },
    { id: 'B1', name: 'Hall B', zone: 'B', capacity: 160, av: true, stepFree: true, standby: false },
    { id: 'B2', name: 'Room 5', zone: 'B', capacity: 110, av: true, stepFree: true, standby: false },
    { id: 'SB', name: 'Standby room', zone: 'B', capacity: 210, av: true, stepFree: true, standby: true },
  ];
  const s = (id: string, title: string, speakerId: string | null, expected: number, needsAv: boolean, needsStepFree: boolean): WorldSession => ({ id, title, speakerId, expected, needsAv, needsStepFree });
  const sessions: WorldSession[] = [
    s('S01', 'Opening keynote', 'spk-1', 150, true, true),
    s('S02', 'Building reliable AI agents', 'spk-2', 95, true, true),
    s('S03', 'Kubernetes security', 'spk-3', 55, true, false),
    s('S04', 'Graph databases in practice', 'spk-4', 50, true, true),
    s('S05', 'Developer tools roundtable', null, 80, false, true),
    s('S06', 'Edge computing at scale', 'spk-5', 65, true, false),
    s('S07', 'Distributed systems clinic', 'spk-2', 45, true, true),
    s('S08', 'Accessibility by design', 'spk-6', 90, false, true),
    s('S09', 'Satellite links', 'spk-7', 40, true, false),
    s('S10', 'Startup founders panel', null, 100, true, true),
    s('S11', 'Observability workshop', 'spk-3', 35, true, false),
    s('S12', 'Closing session', 'spk-1', 140, true, true),
  ];
  const world = makeWorld({
    id: 'hello-bench-v1',
    rooms,
    sessions,
    slots: 4,
    gapMinutes: 10,
    targets: {
      surgeSessionId: 'S04',
      surgeFactor: 1.5,
      primaryRoomId: 'A1',
      avRoomId: 'A2',
      stepFreeZone: 'A',
      delayedSpeakerId: 'spk-1',
      delayedUntilSlot: 1,
      unavailableSpeakerId: 'spk-3',
      unavailableFromSlot: 3,
      walkMinutes: 6,
      increasedWalkMinutes: 15,
    },
  });
  const p = (roomId: string, slot: number): Placement => ({ roomId, slot });
  const baseline = makeSchedule({
    S01: p('A1', 0),
    S02: p('B1', 0),
    S03: p('A2', 0),
    S04: p('A3', 1),
    S05: p('B2', 1),
    S06: p('A2', 1),
    S07: p('A1', 1),
    S08: p('A1', 2),
    S09: p('A3', 2),
    S10: p('B1', 2),
    S11: p('A2', 3),
    S12: p('A1', 3),
  });
  return { world, baseline };
}

/** A deterministic pseudo-random generator (mulberry32), so seeded worlds and random search repeat exactly. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A seeded variation of the v1 world: same rooms, programme shape and disruption kinds, different demand and
 * different disruption targets. Demand is capped at the baseline room's capacity, so every baseline works
 * with no disruption and the benchmark measures real failure discovery. Each world reports its own
 * monotonicity; none is assumed.
 */
export function seededWorld(seed: number): { world: World; baseline: Schedule } {
  const { world, baseline } = benchmarkWorldV1();
  const next = rng(seed);
  const pick = <T,>(items: readonly T[]): T => items[Math.floor(next() * items.length)] as T;
  const capacity = new Map(world.rooms.map((r) => [r.id, r.capacity] as const));
  const sessions = world.sessions.map((session) => {
    const cap = capacity.get(baseline.placements[session.id]?.roomId ?? '') ?? session.expected;
    return { ...session, expected: Math.min(cap, Math.max(20, Math.round(session.expected * (0.7 + next() * 0.6)))) };
  });
  const speakers = [...new Set(sessions.map((x) => x.speakerId).filter((x): x is string => x !== null))];
  const targets: DisruptionTargets = {
    ...world.targets,
    surgeSessionId: pick(sessions).id,
    surgeFactor: Math.round((1.2 + next() * 0.6) * 10) / 10,
    primaryRoomId: pick(['A1', 'B1', 'A3']),
    avRoomId: pick(['A2', 'A3', 'B1', 'B2']),
    stepFreeZone: pick(['A', 'B']),
    delayedSpeakerId: pick(speakers),
    unavailableSpeakerId: pick(speakers),
    unavailableFromSlot: pick([2, 3]),
    increasedWalkMinutes: pick([8, 12, 15]),
  };
  return { world: makeWorld({ ...world, id: `hello-bench-v1-seed-${seed}`, sessions, targets }), baseline };
}
