import type { Poi, Space, Venue, VenueEdge, VenueNode } from '../domain/venue/types';

/**
 * The demo venue. Fictional, and consistent with the demo event guide: the accessible entrance is
 * on the east side, Room 2 is reached by a short stair only, Room 4 and the quiet room are on the
 * first floor, and first aid is next to registration.
 */
export function buildDemoVenue(eventId: string): Venue {
  const rect = (x1: number, y1: number, x2: number, y2: number): Array<readonly [number, number]> => [
    [x1, y1],
    [x2, y1],
    [x2, y2],
    [x1, y2],
  ];

  const spaces: Space[] = [
    { id: 'sp-main', floor: 0, name: 'Main Hall', kind: 'HALL', outline: rect(56, 6, 96, 38), nodeId: 'n-hall', roomId: 'r-main', stepFree: true },
    { id: 'sp-atrium', floor: 0, name: 'Atrium', kind: 'HALL', outline: rect(32, 6, 54, 38), nodeId: 'n-atrium', roomId: null, stepFree: true },
    { id: 'sp-lobby', floor: 0, name: 'Lobby and registration', kind: 'CIRCULATION', outline: rect(32, 40, 56, 56), nodeId: 'n-lobby', roomId: null, stepFree: true },
    { id: 'sp-concourse', floor: 0, name: 'East concourse', kind: 'CIRCULATION', outline: rect(56, 40, 98, 52), nodeId: 'n-concourse', roomId: null, stepFree: true },
    { id: 'sp-corridor', floor: 0, name: 'Workshop corridor', kind: 'CIRCULATION', outline: rect(4, 24, 32, 31), nodeId: 'n-corridor', roomId: null, stepFree: true },
    { id: 'sp-r3', floor: 0, name: 'Room 3', kind: 'ROOM', outline: rect(4, 33, 30, 56), nodeId: 'n-r3', roomId: 'r-3', stepFree: true },
    { id: 'sp-r2', floor: 0, name: 'Room 2', kind: 'ROOM', outline: rect(4, 4, 30, 22), nodeId: 'n-r2', roomId: 'r-2', stepFree: false },
    { id: 'sp-gallery', floor: 1, name: 'First-floor gallery', kind: 'CIRCULATION', outline: rect(32, 36, 90, 44), nodeId: 'n-gallery', roomId: null, stepFree: true },
    { id: 'sp-r4', floor: 1, name: 'Room 4', kind: 'ROOM', outline: rect(58, 8, 90, 34), nodeId: 'n-r4', roomId: 'r-4', stepFree: true },
    { id: 'sp-quiet', floor: 1, name: 'Quiet room', kind: 'QUIET', outline: rect(32, 14, 50, 34), nodeId: 'n-quiet', roomId: null, stepFree: true },
  ];

  const nodes: VenueNode[] = [
    { id: 'n-main-entrance', floor: 0, at: [44, 58] },
    { id: 'n-east-entrance', floor: 0, at: [97, 47] },
    { id: 'n-lobby', floor: 0, at: [44, 48] },
    { id: 'n-registration', floor: 0, at: [38, 51] },
    { id: 'n-first-aid', floor: 0, at: [50, 53] },
    { id: 'n-concourse', floor: 0, at: [76, 46] },
    { id: 'n-hall-door', floor: 0, at: [76, 39] },
    { id: 'n-hall', floor: 0, at: [76, 22] },
    { id: 'n-atrium-door', floor: 0, at: [44, 39] },
    { id: 'n-atrium', floor: 0, at: [43, 22] },
    { id: 'n-atrium-west', floor: 0, at: [32, 27] },
    { id: 'n-corridor', floor: 0, at: [18, 27] },
    { id: 'n-r3-door', floor: 0, at: [18, 32] },
    { id: 'n-r3', floor: 0, at: [17, 44] },
    { id: 'n-r2-steps', floor: 0, at: [18, 23] },
    { id: 'n-r2', floor: 0, at: [17, 13] },
    { id: 'n-lift-0', floor: 0, at: [54, 44] },
    { id: 'n-stairs-0', floor: 0, at: [34, 44] },
    { id: 'n-toilets-0', floor: 0, at: [58, 49] },
    { id: 'n-assembly', floor: 0, at: [44, 64] },
    { id: 'n-lift-1', floor: 1, at: [54, 44] },
    { id: 'n-stairs-1', floor: 1, at: [34, 44] },
    { id: 'n-gallery', floor: 1, at: [54, 40] },
    { id: 'n-gallery-east', floor: 1, at: [74, 40] },
    { id: 'n-r4-door', floor: 1, at: [74, 35] },
    { id: 'n-r4', floor: 1, at: [74, 21] },
    { id: 'n-quiet-door', floor: 1, at: [41, 35] },
    { id: 'n-quiet', floor: 1, at: [41, 24] },
    { id: 'n-toilets-1', floor: 1, at: [58, 42] },
  ];

  const walk = (from: string, to: string): VenueEdge => ({ from, to, kind: 'WALK' });
  const edges: VenueEdge[] = [
    walk('n-main-entrance', 'n-lobby'),
    walk('n-main-entrance', 'n-assembly'),
    walk('n-lobby', 'n-registration'),
    walk('n-lobby', 'n-first-aid'),
    walk('n-lobby', 'n-atrium-door'),
    walk('n-lobby', 'n-lift-0'),
    walk('n-lobby', 'n-stairs-0'),
    walk('n-lift-0', 'n-toilets-0'),
    walk('n-lift-0', 'n-concourse'),
    walk('n-concourse', 'n-east-entrance'),
    walk('n-concourse', 'n-hall-door'),
    walk('n-hall-door', 'n-hall'),
    walk('n-atrium-door', 'n-atrium'),
    walk('n-atrium', 'n-atrium-west'),
    walk('n-atrium-west', 'n-corridor'),
    walk('n-corridor', 'n-r3-door'),
    walk('n-r3-door', 'n-r3'),
    walk('n-corridor', 'n-r2-steps'),
    // Room 2 sits on a raised level reached by a short stair only.
    { from: 'n-r2-steps', to: 'n-r2', kind: 'STAIRS' },
    { from: 'n-lift-0', to: 'n-lift-1', kind: 'LIFT', penaltySeconds: 35 },
    { from: 'n-stairs-0', to: 'n-stairs-1', kind: 'STAIRS' },
    walk('n-lift-1', 'n-gallery'),
    walk('n-lift-1', 'n-toilets-1'),
    walk('n-stairs-1', 'n-gallery'),
    walk('n-gallery', 'n-gallery-east'),
    walk('n-gallery-east', 'n-r4-door'),
    walk('n-r4-door', 'n-r4'),
    walk('n-gallery', 'n-quiet-door'),
    walk('n-quiet-door', 'n-quiet'),
  ];

  const pois: Poi[] = [
    { id: 'poi-main-entrance', floor: 0, kind: 'ENTRANCE', name: 'Main entrance', at: [44, 58], nodeId: 'n-main-entrance' },
    { id: 'poi-east-entrance', floor: 0, kind: 'ACCESSIBLE_ENTRANCE', name: 'Accessible entrance (east)', at: [97, 47], nodeId: 'n-east-entrance' },
    { id: 'poi-registration', floor: 0, kind: 'REGISTRATION', name: 'Registration and lost property', at: [38, 51], nodeId: 'n-registration' },
    { id: 'poi-first-aid', floor: 0, kind: 'FIRST_AID', name: 'First aid', at: [50, 53], nodeId: 'n-first-aid' },
    { id: 'poi-coffee', floor: 0, kind: 'COFFEE', name: 'Coffee', at: [43, 16], nodeId: 'n-atrium' },
    { id: 'poi-toilets-0', floor: 0, kind: 'TOILETS', name: 'Toilets (ground floor)', at: [58, 49], nodeId: 'n-toilets-0' },
    { id: 'poi-toilets-1', floor: 1, kind: 'TOILETS', name: 'Toilets (first floor)', at: [58, 42], nodeId: 'n-toilets-1' },
    { id: 'poi-charging', floor: 0, kind: 'CHARGING', name: 'Charging lockers', at: [26, 27], nodeId: 'n-corridor' },
    { id: 'poi-lift-0', floor: 0, kind: 'LIFT', name: 'Lift', at: [54, 44], nodeId: 'n-lift-0' },
    { id: 'poi-lift-1', floor: 1, kind: 'LIFT', name: 'Lift', at: [54, 44], nodeId: 'n-lift-1' },
    { id: 'poi-stairs-0', floor: 0, kind: 'STAIRS', name: 'Stairs', at: [34, 44], nodeId: 'n-stairs-0' },
    { id: 'poi-stairs-1', floor: 1, kind: 'STAIRS', name: 'Stairs', at: [34, 44], nodeId: 'n-stairs-1' },
    { id: 'poi-assembly', floor: 0, kind: 'ASSEMBLY', name: 'Assembly point (front plaza)', at: [44, 64], nodeId: 'n-assembly' },
  ];

  return {
    eventId,
    name: 'HELLO Summit venue (demo)',
    width: 100,
    depth: 68,
    floors: [
      { id: 0, name: 'Ground floor', elevation: 0 },
      { id: 1, name: 'First floor', elevation: 6 },
    ],
    spaces,
    pois,
    nodes,
    edges,
  };
}
