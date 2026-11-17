'use client';

import type { MissionView } from '@/services/field-atlas';

export interface AtlasSpace {
  id: string;
  floor: number;
  name: string;
  kind: string;
  outline: Array<readonly [number, number]>;
  stepFree: boolean;
  roomId: string | null;
}

export interface AtlasRoute {
  metres: number;
  seconds: number;
  stepFree: boolean;
  steps: string[];
  legs?: Array<{ floor: number; points: Array<readonly [number, number]> }>;
}

export interface AtlasVenue {
  name: string;
  width: number;
  depth: number;
  floors: Array<{ id: number; name: string }>;
  spaces: AtlasSpace[];
}

function bounds(points: ReadonlyArray<readonly [number, number]>) {
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
}

function centroid(points: ReadonlyArray<readonly [number, number]>): [number, number] {
  const n = points.length || 1;
  const x = points.reduce((s, p) => s + p[0], 0) / n;
  const y = points.reduce((s, p) => s + p[1], 0) / n;
  return [x, y];
}

function markerState(m: MissionView): 'done' | 'pending' | 'active' | 'open' | 'locked' {
  if (m.attempt.status === 'APPROVED') return 'done';
  if (m.attempt.status === 'PENDING_REVIEW') return 'pending';
  if (m.attempt.status === 'STARTED' || m.attempt.status === 'REJECTED') return 'active';
  return m.availability.state === 'AVAILABLE' ? 'open' : 'locked';
}

const STATE_WORD: Record<ReturnType<typeof markerState>, string> = {
  done: 'completed',
  pending: 'waiting for review',
  active: 'in progress',
  open: 'available',
  locked: 'locked',
};

/**
 * The venue drawn from its stored geometry. The plan is a schematic of the venue's own coordinates. It is not a
 * geographic map and no GPS position is shown. Markers are buttons, so keyboard and screen-reader users reach the
 * same missions as pointer users.
 */
export function AtlasMap({
  venue,
  missions,
  floor,
  selectedId,
  route,
  onFloor,
  onSelect,
}: {
  venue: AtlasVenue;
  missions: MissionView[];
  floor: number;
  selectedId: string | null;
  route: AtlasRoute | null;
  onFloor: (floor: number) => void;
  onSelect: (id: string) => void;
}) {
  const spaces = venue.spaces.filter((s) => s.floor === floor);
  const spaceById = new Map(venue.spaces.map((s) => [s.id, s]));
  const onThisFloor = missions.filter((m) => m.spaceId && spaceById.get(m.spaceId)?.floor === floor);
  const numbered = new Map(missions.map((m, i) => [m.id, i + 1]));
  const routePoints = route?.legs?.filter((leg) => leg.floor === floor).flatMap((leg) => leg.points.map((p) => `${p[0]},${p[1]}`)).join(' ') ?? '';
  return (
    <div className="atlas-map">
      <div className="atlas-tabs" role="group" aria-label="Floor">
        {venue.floors.map((f) => (
          <button key={f.id} type="button" className="button button--ghost button--sm" aria-pressed={f.id === floor} onClick={() => { onFloor(f.id); }}>
            {f.name}
          </button>
        ))}
      </div>
      <svg viewBox={`0 0 ${venue.width} ${venue.depth}`} role="img" aria-label={`Plan of ${venue.name}, ${venue.floors.find((f) => f.id === floor)?.name ?? ''}. ${onThisFloor.length} missions on this floor.`}>
        {spaces.map((s) => (
          <polygon key={s.id} className={`space space--${s.kind.toLowerCase()}`} points={s.outline.map((p) => `${p[0]},${p[1]}`).join(' ')} strokeDasharray={s.stepFree ? undefined : '1.2 1'}>
            <title>{s.stepFree ? s.name : `${s.name} (not step-free)`}</title>
          </polygon>
        ))}
        {spaces.map((s) => {
          const [x, y] = centroid(s.outline);
          return (
            <text key={`${s.id}-label`} className="space-label" x={x} y={y + 2} textAnchor="middle">
              {s.name}
            </text>
          );
        })}
        {routePoints ? <polyline className="route" points={routePoints} aria-hidden="true" /> : null}
        {onThisFloor.map((m) => {
          const space = m.spaceId ? spaceById.get(m.spaceId) : undefined;
          if (!space) return null;
          const box = bounds(space.outline);
          // The marker sits in the room's top-right corner, clear of the room's name, which is centred.
          const x = box.maxX - Math.min(7, (box.maxX - box.minX) * 0.22);
          const y = box.minY + Math.min(7, (box.maxY - box.minY) * 0.22);
          const state = markerState(m);
          const n = numbered.get(m.id) ?? 0;
          return (
            <g
              key={m.id}
              className={`atlas-marker atlas-marker--${state}`}
              role="button"
              tabIndex={0}
              aria-label={`Mission ${n}: ${m.title}, ${STATE_WORD[state]}, ${m.xp} XP`}
              aria-pressed={selectedId === m.id}
              onClick={() => { onSelect(m.id); }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onSelect(m.id);
                }
              }}
            >
              <circle cx={x} cy={y} r={selectedId === m.id ? 4.6 : 3.9} />
              <text x={x} y={y + 1.3}>{state === 'done' ? '✓' : n}</text>
            </g>
          );
        })}
      </svg>
      <div className="atlas-legend" aria-hidden="true">
        <span>Available</span>
        <span className="l-pending">Waiting for review</span>
        <span className="l-done">Completed</span>
        <span className="l-locked">Locked</span>
      </div>
      <p className="xs faint" style={{ margin: '8px 0 0' }}>
        Schematic of the venue’s stored plan, not a street map. Your location is not tracked.
      </p>
    </div>
  );
}
