/**
 * The venue as data: floors, room footprints, points of interest and a walkable graph.
 *
 * Coordinates are metres on a per-floor plane, origin at the north-west corner. The same model
 * drives every map engine (plan, 3D, heat) and the router, so what a person sees and the route
 * they are given can never disagree. No third-party map tiles are used: nothing about where a
 * person is looking, or going, leaves HELLO.
 */

export type FloorId = 0 | 1;

export interface Floor {
  id: FloorId;
  name: string;
  /** Height above ground in metres, used by the 3D engine. */
  elevation: number;
}

export type Point = readonly [number, number];

export type SpaceKind = 'ROOM' | 'HALL' | 'CIRCULATION' | 'SERVICE' | 'QUIET';

export interface Space {
  id: string;
  floor: FloorId;
  name: string;
  kind: SpaceKind;
  /** Polygon footprint, clockwise. */
  outline: Point[];
  /** Graph node a route to this space ends at. */
  nodeId: string;
  /** Links to the scheduling room, when this space is a bookable room. */
  roomId: string | null;
  stepFree: boolean;
}

export type PoiKind = 'ENTRANCE' | 'ACCESSIBLE_ENTRANCE' | 'REGISTRATION' | 'FIRST_AID' | 'TOILETS' | 'COFFEE' | 'LIFT' | 'STAIRS' | 'CHARGING' | 'ASSEMBLY';

export interface Poi {
  id: string;
  floor: FloorId;
  kind: PoiKind;
  name: string;
  at: Point;
  nodeId: string;
}

export type EdgeKind = 'WALK' | 'STAIRS' | 'LIFT';

export interface VenueNode {
  id: string;
  floor: FloorId;
  at: Point;
}

export interface VenueEdge {
  from: string;
  to: string;
  kind: EdgeKind;
  /** Extra seconds on top of walking time, e.g. waiting for a lift. */
  penaltySeconds?: number;
}

export interface Venue {
  eventId: string;
  name: string;
  /** Plan size in metres. */
  width: number;
  depth: number;
  floors: Floor[];
  spaces: Space[];
  pois: Poi[];
  nodes: VenueNode[];
  edges: VenueEdge[];
}

/** A place a person can route from or to: a space or a point of interest. */
export interface Place {
  id: string;
  name: string;
  floor: FloorId;
  nodeId: string;
  kind: 'SPACE' | 'POI';
}

export function placesOf(venue: Venue): Place[] {
  return [
    ...venue.spaces.filter((s) => s.kind !== 'CIRCULATION').map((s) => ({ id: s.id, name: s.name, floor: s.floor, nodeId: s.nodeId, kind: 'SPACE' as const })),
    ...venue.pois
      .filter((p) => p.kind !== 'LIFT' && p.kind !== 'STAIRS')
      .map((p) => ({ id: p.id, name: p.name, floor: p.floor, nodeId: p.nodeId, kind: 'POI' as const })),
  ].sort((a, b) => a.floor - b.floor || a.name.localeCompare(b.name));
}
