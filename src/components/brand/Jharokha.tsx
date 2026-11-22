'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { GREETINGS, type Greeting } from './scripts';
import { Lotus } from './Motifs';

const TURN_MS = 3200;

/**
 * A Mughal cusped arch in a 1000 x 1000 box: straight jambs up to the springline, then two circular arcs that meet
 * in a point (a two-centred arch), with the edge broken into lobes that bulge into the stone, as in a carved
 * multifoil arch. Pure geometry, computed once.
 */
function cuspedArch(): string {
  const S = 520; // springline
  const c = (S * S + 250_000) / 1000; // left arc centre x; its radius equals c, so it passes (0, S) and the apex (500, 0)
  const start = -Math.PI;
  const end = Math.atan2(-S, 500 - c);
  const lobes = 8;
  const left: Array<[number, number]> = [];
  for (let i = 0; i <= lobes; i += 1) {
    const t = start + ((end - start) * i) / lobes;
    left.push([c + c * Math.cos(t), S + c * Math.sin(t)]);
  }
  const lobe = (a: [number, number], b: [number, number], centre: [number, number]) => {
    const mx = (a[0] + b[0]) / 2;
    const my = (a[1] + b[1]) / 2;
    const dx = mx - centre[0];
    const dy = my - centre[1];
    const len = Math.hypot(dx, dy) || 1;
    return `Q${(mx + (dx / len) * 22).toFixed(1)} ${(my + (dy / len) * 22).toFixed(1)} ${b[0].toFixed(1)} ${b[1].toFixed(1)}`;
  };
  const right = left.map(([x, y]) => [1000 - x, y] as [number, number]).reverse();
  let d = `M0 1000L0 ${S}`;
  for (let i = 0; i < lobes; i += 1) d += lobe(left[i] ?? [0, S], left[i + 1] ?? [500, 0], [c, S]);
  for (let i = 0; i < lobes; i += 1) d += lobe(right[i] ?? [500, 0], right[i + 1] ?? [1000, S], [1000 - c, S]);
  return `${d}L1000 1000Z`;
}

const ARCH = cuspedArch();

/**
 * The landing hero: a carved arch lit from behind, like a palace doorway at sunset, with "hello" turning through
 * seven of India's scripts above the page's own words. The greeting stops turning on hover, focus, a pick, or for
 * people who prefer reduced motion. Each greeting carries its `lang`, so a screen reader pronounces it correctly.
 */
export function Jharokha({ children }: { children: ReactNode }) {
  const [index, setIndex] = useState(0);
  const [held, setHeld] = useState(false);
  const [chosen, setChosen] = useState(false);

  useEffect(() => {
    if (held || chosen || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const timer = window.setInterval(() => {
      setIndex((i) => (i + 1) % GREETINGS.length);
    }, TURN_MS);
    return () => {
      window.clearInterval(timer);
    };
  }, [held, chosen]);

  const greeting = GREETINGS[index % GREETINGS.length] as Greeting;

  return (
    <div
      className="jharokha"
      onPointerEnter={() => {
        setHeld(true);
      }}
      onPointerLeave={() => {
        setHeld(false);
      }}
    >
      <svg className="jharokha__arch" viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-hidden="true" focusable="false">
        <path className="jharokha__light" d={ARCH} />
        <g className="jharokha__carving" fill="none" stroke="currentColor">
          <path d={ARCH} transform="translate(500 1000) scale(1.1 1.075) translate(-500 -1000)" vectorEffect="non-scaling-stroke" strokeWidth="1" opacity="0.5" />
          <path d={ARCH} transform="translate(500 1000) scale(1.05 1.037) translate(-500 -1000)" vectorEffect="non-scaling-stroke" strokeWidth="2" />
        </g>
      </svg>
      <div className="jharokha__inside">
        <Lotus className="jharokha__mark" />
        <p key={greeting.lang} className="jharokha__hello" lang={greeting.lang} style={{ fontFamily: greeting.fontFamily }}>
          {greeting.hello}
        </p>
        <p className="jharokha__caption">Hello in {greeting.name}</p>
        {children}
        <div className="jharokha__picker" role="group" aria-label="Say hello in">
          {GREETINGS.map((g, i) => (
            <button
              key={g.lang}
              type="button"
              lang={g.lang}
              className="jharokha__script"
              style={{ fontFamily: g.fontFamily }}
              aria-pressed={i === index}
              title={g.name}
              onFocus={() => {
                setHeld(true);
              }}
              onClick={() => {
                setIndex(i);
                setChosen(true);
              }}
            >
              {g.endonym}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
