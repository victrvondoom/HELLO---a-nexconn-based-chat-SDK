'use client';

import { useRef, useState } from 'react';
import { CONTINENTS } from '@/domain/kingdom/atlas';
import { Kingdom3D } from './Kingdom3D';

interface Door {
  name: string;
  realm: string;
  own: boolean;
  /** Seeds the 3D generator; the event's own kingdom uses its real seed. */
  seed: string;
}

/**
 * The atlas of kingdoms. Every channel is a door: click one and its living 3D kingdom (the inherited Chatdom
 * renderer, simulated townsfolk) opens under the map. Only one 3D scene is mounted at a time.
 * Sample channels are fixed examples; the event's own kingdom is the only real one.
 */
export function KingdomMap({ own }: { own: { name: string; seed: string } | null }) {
  const [door, setDoor] = useState<Door | null>(own ? { name: own.name, realm: 'Your event', own: true, seed: own.seed } : null);

  const panel = useRef<HTMLElement>(null);
  const open = (next: Door) => {
    setDoor(next);
    // The 3D view sits under the map, so bring it into view when a door is clicked.
    setTimeout(() => { panel.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 50);
  };

  return (
    <div className="stack" style={{ gap: 16 }}>
      <svg viewBox="0 0 100 60" role="group" aria-label="Map of language continents with channel doors" style={{ width: '100%', background: '#cfe8f7', borderRadius: 12 }}>
        {CONTINENTS.map((c) => (
          <g key={c.id}>
            <rect x={c.x} y={c.y} width={c.w} height={c.h} rx={7} fill={c.colour} stroke="#8a7a55" strokeWidth={0.3} />
            <text x={c.x + c.w / 2} y={c.y + 4} textAnchor="middle" fontSize={2.6} fill="#3b2f1a">{c.name}</text>
            {c.channels.map((ch) => {
              const active = door?.name === ch.name && !door.own;
              return (
                <g
                  key={ch.name}
                  role="button"
                  tabIndex={0}
                  aria-label={`Open ${ch.name}, ${ch.realm}${ch.live ? ', live' : ''}`}
                  style={{ cursor: 'pointer', outline: 'none' }}
                  onClick={() => { open({ name: ch.name, realm: ch.realm, own: false, seed: ch.name }); }}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') open({ name: ch.name, realm: ch.realm, own: false, seed: ch.name }); }}
                >
                  <circle cx={ch.x} cy={ch.y} r={active ? 1.8 : 1.3} fill={ch.live ? '#f59e0b' : '#6b7280'} stroke={active ? '#111827' : 'none'} strokeWidth={0.3} />
                  <text x={ch.x} y={ch.y + 3.4} textAnchor="middle" fontSize={1.8} fill="#1f2937">{ch.name}</text>
                </g>
              );
            })}
          </g>
        ))}
      </svg>

      <section ref={panel} className="card" aria-live="polite">
        {door ? (
          <>
            <h2 style={{ marginTop: 0 }}>
              {door.name} <span className="badge">{door.own ? 'your kingdom' : `sample · ${door.realm}`}</span>
            </h2>
            <Kingdom3D key={door.name} seed={door.seed} name={door.name} />
          </>
        ) : (
          <p>Click a door on the map to see its kingdom.</p>
        )}
      </section>
    </div>
  );
}
