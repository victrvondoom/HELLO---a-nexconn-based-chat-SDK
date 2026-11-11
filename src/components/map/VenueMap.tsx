'use client';

import { useMemo, useState, type KeyboardEvent } from 'react';
import type { FloorId, Point, Poi, PoiKind, Space, Venue } from '@/domain/venue/types';
import { placesOf } from '@/domain/venue/types';
import { findRoute, type RouteResult } from '@/domain/venue/route';

/**
 * The venue map. One model, three engines:
 *  - Plan: a 2D floor plan, one floor at a time.
 *  - 3D: an isometric model of every floor, stacked, that can be turned.
 *  - Heat: the plan coloured by recorded occupancy, with open-incident counts for staff.
 * Routes are computed in the browser from the same graph and drawn in every engine.
 * Everything is inline SVG: no tiles, no third-party map service, nothing leaves HELLO.
 */

export interface MapRoomInfo {
  roomId: string;
  capacity: number;
  occupancy: number | null;
  sourceLabel: string | null;
  /** Null when the viewer may not see operational counts. */
  openIncidents: number | null;
  nowOrNext: string | null;
}

type Engine = 'plan' | '3d' | 'heat';

const ENGINES: Array<{ id: Engine; label: string; hint: string }> = [
  { id: 'plan', label: 'Plan', hint: 'Floor plan, one floor at a time' },
  { id: '3d', label: '3D', hint: 'Every floor, stacked; turn it to look around' },
  { id: 'heat', label: 'Live heat', hint: 'Rooms coloured by recorded occupancy' },
];

const POI_GLYPH: Record<PoiKind, string> = {
  ENTRANCE: 'E',
  ACCESSIBLE_ENTRANCE: 'A',
  REGISTRATION: 'i',
  FIRST_AID: '+',
  TOILETS: 'WC',
  COFFEE: 'C',
  LIFT: 'L',
  STAIRS: 'S',
  CHARGING: 'Ch',
  ASSEMBLY: 'AP',
};

function centroid(points: readonly Point[]): Point {
  const n = points.length || 1;
  return [points.reduce((s, p) => s + p[0], 0) / n, points.reduce((s, p) => s + p[1], 0) / n];
}

function heatLevel(info: MapRoomInfo | undefined): 'none' | 'calm' | 'busy' | 'full' {
  if (!info || info.occupancy === null) return 'none';
  const ratio = info.occupancy / Math.max(1, info.capacity);
  return ratio >= 1 ? 'full' : ratio >= 0.7 ? 'busy' : 'calm';
}

const HEAT_LABEL = { none: 'No data', calm: 'Room to spare', busy: 'Filling up', full: 'At or over capacity' } as const;

export function VenueMap({
  venue,
  rooms,
  initialFrom,
  initialTo,
  initialStepFree,
  operational,
}: {
  venue: Venue;
  rooms: Record<string, MapRoomInfo>;
  initialFrom: string;
  initialTo: string | null;
  initialStepFree: boolean;
  operational: boolean;
}) {
  const places = useMemo(() => placesOf(venue), [venue]);
  const [engine, setEngine] = useState<Engine>('plan');
  const [floor, setFloor] = useState<FloorId>(() => places.find((p) => p.id === initialTo)?.floor ?? 0);
  const [from, setFrom] = useState(initialFrom);
  const [to, setTo] = useState<string | null>(initialTo);
  const [stepFree, setStepFree] = useState(initialStepFree);
  const [angle, setAngle] = useState(35);
  const [selected, setSelected] = useState<string | null>(initialTo);

  const route: RouteResult | null = useMemo(() => {
    const a = places.find((p) => p.id === from);
    const b = places.find((p) => p.id === to);
    if (!a || !b || a.id === b.id) return null;
    return findRoute(venue, a.nodeId, b.nodeId, { stepFree });
  }, [venue, places, from, to, stepFree]);

  const selectedSpace = venue.spaces.find((s) => s.id === selected) ?? null;
  const selectedPoi = venue.pois.find((p) => p.id === selected) ?? null;
  const selectedInfo = selectedSpace?.roomId ? rooms[selectedSpace.roomId] : undefined;

  const select = (id: string) => {
    setSelected(id);
  };

  return (
    <div className="map">
      <div className="map__toolbar">
        <div className="segmented" role="tablist" aria-label="Map engine">
          {ENGINES.map((e) => (
            <button
              key={e.id}
              type="button"
              role="tab"
              aria-selected={engine === e.id}
              title={e.hint}
              className={engine === e.id ? 'segmented__item is-active' : 'segmented__item'}
              onClick={() => {
                setEngine(e.id);
              }}
            >
              {e.label}
            </button>
          ))}
        </div>
        {engine !== '3d' ? (
          <div className="segmented" role="group" aria-label="Floor">
            {venue.floors.map((f) => (
              <button
                key={f.id}
                type="button"
                aria-pressed={floor === f.id}
                className={floor === f.id ? 'segmented__item is-active' : 'segmented__item'}
                onClick={() => {
                  setFloor(f.id);
                }}
              >
                {f.name}
              </button>
            ))}
          </div>
        ) : (
          <label className="map__turn">
            <span className="xs faint">Turn</span>
            <input
              type="range"
              min={0}
              max={359}
              value={angle}
              onChange={(e) => {
                setAngle(Number(e.target.value));
              }}
              aria-label="Turn the 3D model"
            />
          </label>
        )}
      </div>

      <div className="map__body">
        <div className="map__canvas">
          {engine === '3d' ? (
            <Iso venue={venue} rooms={rooms} angle={angle} route={route} selected={selected} onSelect={select} />
          ) : (
            <Plan
              venue={venue}
              floor={floor}
              rooms={rooms}
              heat={engine === 'heat'}
              operational={operational}
              route={route}
              selected={selected}
              onSelect={select}
            />
          )}
          {engine === 'heat' ? (
            <div className="map__legend" aria-label="Legend">
              {(['calm', 'busy', 'full', 'none'] as const).map((l) => (
                <span key={l}>
                  <i className={`swatch swatch--${l}`} aria-hidden="true" /> {HEAT_LABEL[l]}
                </span>
              ))}
            </div>
          ) : null}
        </div>

        <aside className="map__panel">
          <section className="map__card" aria-labelledby="route-heading">
            <h2 id="route-heading">Directions</h2>
            <div className="field">
              <label htmlFor="route-from">From</label>
              <select
                id="route-from"
                value={from}
                onChange={(e) => {
                  setFrom(e.target.value);
                }}
              >
                {places.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="route-to">To</label>
              <select
                id="route-to"
                value={to ?? ''}
                onChange={(e) => {
                  setTo(e.target.value || null);
                  setSelected(e.target.value || null);
                  const target = places.find((p) => p.id === e.target.value);
                  if (target) setFloor(target.floor);
                }}
              >
                <option value="">Choose a place</option>
                {places.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <label className="toggle">
              <input
                type="checkbox"
                checked={stepFree}
                onChange={(e) => {
                  setStepFree(e.target.checked);
                }}
              />
              <span>Step-free route (lifts and ramps only)</span>
            </label>

            {route === null ? (
              <p className="small muted">Choose where you are going. Routes are worked out on your device.</p>
            ) : route.ok ? (
              <div className="stack" style={{ gap: 8 }} aria-live="polite">
                <div className="route-sum">
                  <strong>{Math.max(1, Math.round(route.seconds / 60))} min</strong>
                  <span className="muted small">
                    {route.metres} m{route.stepFree ? ' · step-free' : ''}
                  </span>
                </div>
                <ol className="route-steps">
                  {route.steps.map((s, i) => (
                    <li key={`${i}-${s}`}>{s}</li>
                  ))}
                </ol>
              </div>
            ) : (
              <p className="notice notice--error small" role="status">
                {route.reason}
              </p>
            )}
          </section>

          {selectedSpace || selectedPoi ? (
            <section className="map__card" aria-label="Selected place">
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <h2>{selectedSpace?.name ?? selectedPoi?.name}</h2>
                <span className="badge">{venue.floors.find((f) => f.id === (selectedSpace?.floor ?? selectedPoi?.floor))?.name}</span>
              </div>
              {selectedSpace ? (
                <ul className="list-plain small">
                  <li>{selectedSpace.stepFree ? 'Step-free access' : 'Reached by stairs only'}</li>
                  {selectedInfo ? (
                    <>
                      <li>
                        {selectedInfo.occupancy === null
                          ? `Capacity ${selectedInfo.capacity}. No occupancy figure recorded.`
                          : `${selectedInfo.occupancy} of ${selectedInfo.capacity} · ${selectedInfo.sourceLabel ?? ''}`}
                      </li>
                      {selectedInfo.nowOrNext ? <li>{selectedInfo.nowOrNext}</li> : null}
                      {selectedInfo.openIncidents !== null ? <li>{selectedInfo.openIncidents} open incidents</li> : null}
                    </>
                  ) : null}
                </ul>
              ) : null}
              <button
                type="button"
                className="button button--sm"
                onClick={() => {
                  setTo(selected);
                }}
              >
                Directions here
              </button>
            </section>
          ) : null}
        </aside>
      </div>
    </div>
  );
}

function activate(event: KeyboardEvent, run: () => void) {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    run();
  }
}

function Plan({
  venue,
  floor,
  rooms,
  heat,
  operational,
  route,
  selected,
  onSelect,
}: {
  venue: Venue;
  floor: FloorId;
  rooms: Record<string, MapRoomInfo>;
  heat: boolean;
  operational: boolean;
  route: RouteResult | null;
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  const spaces = venue.spaces.filter((s) => s.floor === floor);
  const pois = venue.pois.filter((p) => p.floor === floor);
  const legs = route?.ok ? route.legs.filter((l) => l.floor === floor && l.kind === 'WALK') : [];
  const changes = route?.ok ? route.legs.filter((l) => l.floor === floor && l.kind !== 'WALK') : [];
  const start = route?.ok ? venue.nodes.find((n) => n.id === route.nodeIds[0]) : undefined;
  const end = route?.ok ? venue.nodes.find((n) => n.id === route.nodeIds[route.nodeIds.length - 1]) : undefined;

  return (
    <svg className="plan" viewBox={`-4 -4 ${venue.width + 8} ${venue.depth + 8}`} role="img" aria-label={`Floor plan: ${venue.floors.find((f) => f.id === floor)?.name ?? ''}`}>
      <defs>
        <pattern id="grid" width="4" height="4" patternUnits="userSpaceOnUse">
          <path d="M4 0H0V4" fill="none" stroke="#e7eff7" strokeWidth="0.15" />
        </pattern>
        <pattern id="stairs-hatch" width="1.6" height="1.6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="1.6" stroke="#94a3b8" strokeWidth="0.35" />
        </pattern>
      </defs>
      <rect x="-4" y="-4" width={venue.width + 8} height={venue.depth + 8} fill="url(#grid)" />
      {spaces.map((s) => (
        <SpaceShape
          key={s.id}
          space={s}
          info={s.roomId ? rooms[s.roomId] : undefined}
          heat={heat}
          operational={operational}
          selected={selected === s.id}
          onSelect={onSelect}
        />
      ))}
      {legs.map((leg, i) => (
        <polyline key={`leg-${i}`} className="route-line" points={leg.points.map((p) => p.join(',')).join(' ')} />
      ))}
      {changes.map((leg, i) => {
        const at = leg.points[0];
        if (!at) return null;
        return (
          <g key={`chg-${i}`} transform={`translate(${at[0]} ${at[1]})`} className="route-change">
            <circle r="2.6" />
            <text y="0.9" textAnchor="middle">
              {leg.kind === 'LIFT' ? 'Lift' : 'Stairs'}
            </text>
          </g>
        );
      })}
      {pois.map((p) => (
        <PoiMarker key={p.id} poi={p} selected={selected === p.id} onSelect={onSelect} />
      ))}
      {start && start.floor === floor ? <circle className="route-start" cx={start.at[0]} cy={start.at[1]} r="1.6" /> : null}
      {end && end.floor === floor ? (
        <g className="route-end" transform={`translate(${end.at[0]} ${end.at[1]})`}>
          <circle r="3.2" className="route-end__pulse" />
          <circle r="1.7" />
        </g>
      ) : null}
    </svg>
  );
}

function SpaceShape({
  space,
  info,
  heat,
  operational,
  selected,
  onSelect,
}: {
  space: Space;
  info: MapRoomInfo | undefined;
  heat: boolean;
  operational: boolean;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  const [cx] = centroid(space.outline);
  // Labels sit near the top of the space, so the route pin at its centre never covers them.
  const cy = Math.min(...space.outline.map((p) => p[1])) + (space.kind === 'CIRCULATION' ? 3 : 5.2);
  const level = heatLevel(info);
  const className = [
    'space',
    `space--${space.kind.toLowerCase()}`,
    heat && space.roomId ? `space--heat-${level}` : '',
    selected ? 'is-selected' : '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <g
      className={className}
      role="button"
      tabIndex={0}
      aria-label={`${space.name}${space.stepFree ? '' : ', stairs only'}`}
      onClick={() => {
        onSelect(space.id);
      }}
      onKeyDown={(e) => {
        activate(e, () => {
          onSelect(space.id);
        });
      }}
    >
      <polygon points={space.outline.map((p) => p.join(',')).join(' ')} />
      {!space.stepFree ? <polygon className="space__hatch" points={space.outline.map((p) => p.join(',')).join(' ')} fill="url(#stairs-hatch)" /> : null}
      <text x={cx} y={cy} textAnchor="middle" className="space__label">
        {space.name}
      </text>
      {heat && info ? (
        <text x={cx} y={cy + 3.4} textAnchor="middle" className="space__sub">
          {info.occupancy === null ? 'no data' : `${info.occupancy}/${info.capacity}`}
        </text>
      ) : null}
      {heat && operational && info && info.openIncidents ? (
        <g transform={`translate(${space.outline[1]?.[0] ?? cx} ${space.outline[1]?.[1] ?? cy})`} className="space__pin">
          <circle r="2.4" cx="-2.6" cy="2.6" />
          <text x="-2.6" y="3.5" textAnchor="middle">
            {info.openIncidents}
          </text>
        </g>
      ) : null}
    </g>
  );
}

function PoiMarker({ poi, selected, onSelect }: { poi: Poi; selected: boolean; onSelect: (id: string) => void }) {
  return (
    <g
      className={`poi poi--${poi.kind.toLowerCase()}${selected ? ' is-selected' : ''}`}
      transform={`translate(${poi.at[0]} ${poi.at[1]})`}
      role="button"
      tabIndex={0}
      aria-label={poi.name}
      onClick={() => {
        onSelect(poi.id);
      }}
      onKeyDown={(e) => {
        activate(e, () => {
          onSelect(poi.id);
        });
      }}
    >
      <title>{poi.name}</title>
      <circle r="1.9" />
      <text y="0.75" textAnchor="middle">
        {POI_GLYPH[poi.kind]}
      </text>
    </g>
  );
}

/** Isometric engine. Rotates the plan about its centre, projects it, and paints back to front. */
function Iso({
  venue,
  rooms,
  angle,
  route,
  selected,
  onSelect,
}: {
  venue: Venue;
  rooms: Record<string, MapRoomInfo>;
  angle: number;
  route: RouteResult | null;
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  const rad = (angle * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const cx = venue.width / 2;
  const cy = venue.depth / 2;
  const LIFT = 5.6; // exploded view: floors are pulled apart so every level can be seen
  const rot = (p: Point): Point => {
    const x = p[0] - cx;
    const y = p[1] - cy;
    return [x * cos - y * sin, x * sin + y * cos];
  };
  const project = (p: Point, z: number): Point => {
    const [x, y] = rot(p);
    return [(x - y) * 0.866, (x + y) * 0.5 - z];
  };
  const pts = (list: Point[]) => list.map((p) => `${p[0].toFixed(2)},${p[1].toFixed(2)}`).join(' ');
  const depthOf = (p: Point) => {
    const [x, y] = rot(p);
    return x + y;
  };

  const layers = venue.floors.map((f) => {
    const z = f.elevation * LIFT;
    const own = venue.spaces.filter((s) => s.floor === f.id);
    const xs = own.flatMap((s) => s.outline.map((p) => p[0]));
    const ys = own.flatMap((s) => s.outline.map((p) => p[1]));
    const slab: Point[] = [
      [Math.min(...xs) - 2, Math.min(...ys) - 2],
      [Math.max(...xs) + 2, Math.min(...ys) - 2],
      [Math.max(...xs) + 2, Math.max(...ys) + 2],
      [Math.min(...xs) - 2, Math.max(...ys) + 2],
    ];
    const prisms = own
      .map((s) => {
        const h = s.kind === 'CIRCULATION' ? 0.8 : s.kind === 'HALL' ? 7 : 5;
        return { s, h, depth: depthOf(centroid(s.outline)) };
      })
      .sort((a, b) => a.depth - b.depth);
    return { f, z, slab, prisms };
  });

  const routePath: Point[] = [];
  if (route?.ok) {
    for (const id of route.nodeIds) {
      const n = venue.nodes.find((x) => x.id === id);
      const f = venue.floors.find((x) => x.id === n?.floor);
      if (n && f) routePath.push(project(n.at, f.elevation * LIFT + 0.9));
    }
  }

  // Fit the view to the model at this angle, so turning it never crops a floor.
  const all = layers.flatMap(({ z, slab }) => [...slab.map((p) => project(p, z)), ...slab.map((p) => project(p, z + 8))]);
  const minX = Math.min(...all.map((p) => p[0])) - 6;
  const maxX = Math.max(...all.map((p) => p[0])) + 6;
  const minY = Math.min(...all.map((p) => p[1])) - 6;
  const maxY = Math.max(...all.map((p) => p[1])) + 8;

  return (
    <svg className="iso" viewBox={`${minX.toFixed(1)} ${minY.toFixed(1)} ${(maxX - minX).toFixed(1)} ${(maxY - minY).toFixed(1)}`} role="img" aria-label="3D model of the venue">
      <defs>
        <linearGradient id="iso-slab" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="1" stopColor="#e0f2fe" />
        </linearGradient>
      </defs>
      {layers.map(({ f, z, slab, prisms }) => (
        <g key={f.id} className="iso__floor">
          <polygon className="iso__slab" points={pts(slab.map((p) => project(p, z)))} />
          {prisms.map(({ s, h }) => {
            const info = s.roomId ? rooms[s.roomId] : undefined;
            const level = heatLevel(info);
            const base = s.outline.map((p) => project(p, z));
            const top = s.outline.map((p) => project(p, z + h));
            const walls = s.outline
              .map((p, i) => {
                const q = s.outline[(i + 1) % s.outline.length] ?? p;
                const nx = q[1] - p[1];
                const ny = -(q[0] - p[0]);
                const rnx = nx * cos - ny * sin;
                const rny = nx * sin + ny * cos;
                return { i, visible: rnx + rny > 0, q, p, shade: rnx - rny };
              })
              .filter((w) => w.visible);
            return (
              <g
                key={s.id}
                className={`iso__space iso__space--${s.kind.toLowerCase()} ${s.roomId ? `iso--heat-${level}` : ''} ${selected === s.id ? 'is-selected' : ''}`}
                role="button"
                tabIndex={0}
                aria-label={s.name}
                onClick={() => {
                  onSelect(s.id);
                }}
                onKeyDown={(e) => {
                  activate(e, () => {
                    onSelect(s.id);
                  });
                }}
              >
                <polygon className="iso__base" points={pts(base)} />
                {walls.map((w) => (
                  <polygon
                    key={w.i}
                    className={w.shade > 0 ? 'iso__wall iso__wall--lit' : 'iso__wall'}
                    points={pts([project(w.p, z), project(w.q, z), project(w.q, z + h), project(w.p, z + h)])}
                  />
                ))}
                <polygon className="iso__top" points={pts(top)} />
                {s.kind !== 'CIRCULATION' ? (
                  <text className="iso__label" x={centroid(top)[0]} y={centroid(top)[1]} textAnchor="middle">
                    {s.name.replace(/ \(.*\)$/, '')}
                  </text>
                ) : null}
              </g>
            );
          })}
          <text className="iso__floor-label" x={Math.min(...slab.map((p) => project(p, z)[0])) + 2} y={Math.max(...slab.map((p) => project(p, z)[1])) - 2}>
            {f.name}
          </text>
        </g>
      ))}
      {routePath.length > 1 ? <polyline className="route-line route-line--iso" points={pts(routePath)} /> : null}
    </svg>
  );
}
