import type { EdgeKind, FloorId, Venue, VenueNode } from './types';

/**
 * Wayfinding. Dijkstra over the venue graph, by walking time.
 *
 * With `stepFree`, stairs are removed from the graph before searching, so a step-free route is
 * either truly step-free or reported as impossible, with the reason. It is never a normal route
 * with a warning attached.
 */

/** Typical indoor walking pace; slower in step-free mode to reflect wheelchair and mobility-aid users. */
const WALK_MPS = 1.2;
const STEP_FREE_MPS = 0.9;
const STAIRS_SECONDS_PER_FLOOR = 25;
const FLOOR_HEIGHT_M = 5;

export interface RouteLeg {
  floor: FloorId;
  kind: EdgeKind;
  points: Array<readonly [number, number]>;
  metres: number;
}

export type RouteResult =
  | {
      ok: true;
      nodeIds: string[];
      legs: RouteLeg[];
      metres: number;
      seconds: number;
      steps: string[];
      stepFree: boolean;
    }
  | { ok: false; reason: string };

export interface RouteOptions {
  stepFree: boolean;
}

function distance(a: VenueNode, b: VenueNode): number {
  return Math.hypot(a.at[0] - b.at[0], a.at[1] - b.at[1]);
}

function edgeSeconds(a: VenueNode, b: VenueNode, kind: EdgeKind, penalty: number, stepFree: boolean): number {
  if (kind === 'LIFT') return penalty + Math.abs(a.floor - b.floor) * 8;
  if (kind === 'STAIRS') return penalty + Math.max(1, Math.abs(a.floor - b.floor)) * STAIRS_SECONDS_PER_FLOOR + distance(a, b) / WALK_MPS;
  return penalty + distance(a, b) / (stepFree ? STEP_FREE_MPS : WALK_MPS);
}

export function findRoute(venue: Venue, fromNodeId: string, toNodeId: string, options: RouteOptions): RouteResult {
  const nodes = new Map(venue.nodes.map((n) => [n.id, n] as const));
  const from = nodes.get(fromNodeId);
  const to = nodes.get(toNodeId);
  if (!from || !to) return { ok: false, reason: 'That place is not on the venue map.' };

  type Arc = { to: string; kind: EdgeKind; seconds: number };
  const adjacency = new Map<string, Arc[]>();
  for (const e of venue.edges) {
    if (options.stepFree && e.kind === 'STAIRS') continue;
    const a = nodes.get(e.from);
    const b = nodes.get(e.to);
    if (!a || !b) continue;
    const s = edgeSeconds(a, b, e.kind, e.penaltySeconds ?? 0, options.stepFree);
    (adjacency.get(a.id) ?? adjacency.set(a.id, []).get(a.id))?.push({ to: b.id, kind: e.kind, seconds: s });
    (adjacency.get(b.id) ?? adjacency.set(b.id, []).get(b.id))?.push({ to: a.id, kind: e.kind, seconds: s });
  }

  // The graph is small (tens of nodes), so a linear scan for the next node is clearer than a heap.
  const best = new Map<string, number>([[from.id, 0]]);
  const previous = new Map<string, { node: string; kind: EdgeKind }>();
  const done = new Set<string>();
  for (;;) {
    let current: string | null = null;
    let currentCost = Infinity;
    for (const [id, cost] of best) {
      if (!done.has(id) && cost < currentCost) {
        current = id;
        currentCost = cost;
      }
    }
    if (current === null || current === to.id) break;
    done.add(current);
    for (const arc of adjacency.get(current) ?? []) {
      const next = currentCost + arc.seconds;
      if (next < (best.get(arc.to) ?? Infinity)) {
        best.set(arc.to, next);
        previous.set(arc.to, { node: current, kind: arc.kind });
      }
    }
  }

  if (!best.has(to.id)) {
    return {
      ok: false,
      reason: options.stepFree
        ? 'There is no step-free route to this place. It can only be reached by stairs. Ask a staff member for help.'
        : 'These two places are not connected on the venue map.',
    };
  }

  const nodeIds: string[] = [to.id];
  const kinds: EdgeKind[] = [];
  let cursor = to.id;
  while (cursor !== from.id) {
    const step = previous.get(cursor);
    if (!step) break;
    kinds.unshift(step.kind);
    nodeIds.unshift(step.node);
    cursor = step.node;
  }

  const legs: RouteLeg[] = [];
  let metres = 0;
  for (let i = 0; i < kinds.length; i++) {
    const a = nodes.get(nodeIds[i] ?? '');
    const b = nodes.get(nodeIds[i + 1] ?? '');
    const kind = kinds[i];
    if (!a || !b || !kind) continue;
    const length = a.floor === b.floor ? distance(a, b) : Math.abs(a.floor - b.floor) * FLOOR_HEIGHT_M;
    metres += length;
    const last = legs[legs.length - 1];
    if (last && last.kind === kind && last.floor === a.floor && a.floor === b.floor) {
      last.points.push(b.at);
      last.metres += length;
    } else {
      legs.push({ floor: a.floor, kind, points: [a.at, b.at], metres: length });
    }
  }

  return {
    ok: true,
    nodeIds,
    legs,
    metres: Math.round(metres),
    seconds: Math.round(best.get(to.id) ?? 0),
    steps: describe(venue, legs, nodeIds, options.stepFree),
    stepFree: options.stepFree || !kinds.includes('STAIRS'),
  };
}

function describe(venue: Venue, legs: RouteLeg[], nodeIds: string[], stepFree: boolean): string[] {
  const floorName = (id: FloorId) => venue.floors.find((f) => f.id === id)?.name ?? `Floor ${id}`;
  const steps: string[] = [];
  for (let i = 0; i < legs.length; i++) {
    const leg = legs[i];
    if (!leg) continue;
    if (leg.kind === 'WALK') {
      steps.push(`Walk about ${Math.max(5, Math.round(leg.metres / 5) * 5)} m on the ${floorName(leg.floor).toLowerCase()}.`);
    } else {
      const next = legs[i + 1];
      const target = next ? floorName(next.floor) : 'the next level';
      steps.push(leg.kind === 'LIFT' ? `Take the lift to the ${target.toLowerCase()}.` : `Take the stairs${next && next.floor !== leg.floor ? ` to the ${target.toLowerCase()}` : ''}.`);
    }
  }
  const end = nodeIds[nodeIds.length - 1];
  const destination = venue.spaces.find((s) => s.nodeId === end)?.name ?? venue.pois.find((p) => p.nodeId === end)?.name;
  if (destination) steps.push(`Arrive at ${destination}.`);
  if (stepFree) steps.push('This route has no steps or stairs.');
  return steps;
}
