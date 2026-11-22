'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { GREETINGS, type Greeting } from './scripts';

const TURN_MS = 3400;

/**
 * A Mughal cusped arch: straight jambs from `bottom` up to the springline, then two circular arcs meeting in a point
 * at `top`, with the edge broken into lobes that bulge into the stone and meet in sharp cusps, as in a carved
 * multifoil arch. Every argument is in scene units (the 1600 x 900 viewBox).
 */
function cuspedArch(cx: number, top: number, width: number, spring: number, bottom: number, lobes: number, depth: number): string {
  const half = width / 2;
  const rise = spring - top;
  // The left half of the arch as one cubic curve: up from the springline, then leaning in to a soft point at the apex.
  const p0: [number, number] = [cx - half, spring];
  const p1: [number, number] = [cx - half, spring - rise * 0.62];
  const p2: [number, number] = [cx - half * 0.3, top + rise * 0.16];
  const p3: [number, number] = [cx, top];
  const at = (t: number): [number, number] => {
    const u = 1 - t;
    return [
      u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
      u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
    ];
  };
  const left: Array<[number, number]> = [];
  for (let i = 0; i <= lobes; i += 1) left.push(at(i / lobes));
  // Each lobe bulges outward (into the stone), so lobes meet in sharp cusps pointing into the opening.
  const lobe = (a: [number, number], b: [number, number]) => {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy) || 1;
    const mx = (a[0] + b[0]) / 2 + (dy / len) * depth;
    const my = (a[1] + b[1]) / 2 + (-dx / len) * depth;
    return `Q${mx.toFixed(1)} ${my.toFixed(1)} ${b[0].toFixed(1)} ${b[1].toFixed(1)}`;
  };
  const right = left.map(([x, y]) => [2 * cx - x, y] as [number, number]).reverse();
  let d = `M${cx - half} ${bottom}L${cx - half} ${spring}`;
  for (let i = 0; i < lobes; i += 1) d += lobe(left[i] ?? p0, left[i + 1] ?? p3);
  for (let i = 0; i < lobes; i += 1) d += lobe(right[i] ?? p3, right[i + 1] ?? [cx + half, spring]);
  return `${d}L${cx + half} ${bottom}Z`;
}

const CX = 800;
const OPENING = cuspedArch(CX, 160, 660, 440, 960, 9, 10);
const MOULD_1 = cuspedArch(CX, 136, 712, 440, 960, 9, 11);
const MOULD_2 = cuspedArch(CX, 110, 768, 440, 960, 9, 12);
const MOULD_3 = cuspedArch(CX, 84, 826, 440, 960, 9, 11);

/** Nested carved frames around the arch: [x, y, width, band thickness]. Each runs past the bottom of the scene. */
const FRAMES: Array<[number, number, number, number]> = [
  [262, 8, 1076, 34],
  [320, 46, 960, 12],
  [352, 64, 896, 26],
];

/**
 * The scene behind the landing page's words: a palace doorway at sunset. Original artwork, drawn in SVG: a weathered
 * green plaster wall, nested carved frames with filigree in relief, a cusped arch with three bevelled stone mouldings,
 * light blooming through the opening, a low sunbeam across the right and coloured haze at the edges, like light
 * through old glass. Static: nothing in it animates, so it costs one paint.
 */
function DoorwayScene() {
  return (
    <svg className="doorway__scene" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="dw-wall" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#35503f" />
          <stop offset="0.45" stopColor="#56704f" />
          <stop offset="1" stopColor="#7d8a5c" />
        </linearGradient>
        <linearGradient id="dw-stone" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#cbbf98" />
          <stop offset="0.55" stopColor="#e8dcb8" />
          <stop offset="1" stopColor="#f6ecd0" />
        </linearGradient>
        <linearGradient id="dw-stone-shade" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#6d7d5a" />
          <stop offset="0.5" stopColor="#a5a57c" />
          <stop offset="1" stopColor="#efe2bd" />
        </linearGradient>
        <radialGradient id="dw-light" cx="0.5" cy="0.55" r="0.6">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.7" stopColor="#fffdf7" />
          <stop offset="1" stopColor="#fff1d6" />
        </radialGradient>
        <linearGradient id="dw-beam" x1="1" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff6e2" stopOpacity="0.85" />
          <stop offset="1" stopColor="#fff6e2" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="dw-haze-l" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#5d7fd6" stopOpacity="0.9" />
          <stop offset="1" stopColor="#5d7fd6" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="dw-haze-r" x1="1" y1="0" x2="0" y2="0">
          <stop offset="0" stopColor="#8fb2e8" stopOpacity="0.9" />
          <stop offset="1" stopColor="#8fb2e8" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="dw-haze-b" x1="0" y1="1" x2="0" y2="0">
          <stop offset="0" stopColor="#f29a8c" stopOpacity="0.85" />
          <stop offset="0.5" stopColor="#f4c27a" stopOpacity="0.35" />
          <stop offset="1" stopColor="#f4c27a" stopOpacity="0" />
        </linearGradient>
        <radialGradient id="dw-haze-teal" cx="0" cy="0.62" r="0.5">
          <stop offset="0" stopColor="#3fb39a" stopOpacity="0.75" />
          <stop offset="1" stopColor="#3fb39a" stopOpacity="0" />
        </radialGradient>

        {/* Weathered plaster: fine grain and broad damp patches. */}
        <filter id="dw-plaster" x="0" y="0" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="4" result="grain" />
          <feTurbulence type="fractalNoise" baseFrequency="0.006 0.012" numOctaves="3" seed="9" result="patch" />
          <feColorMatrix in="grain" values="0 0 0 0 0.1  0 0 0 0 0.14  0 0 0 0 0.1  0 0 0 0.16 0" result="g" />
          <feColorMatrix in="patch" values="0 0 0 0 0.08  0 0 0 0 0.12  0 0 0 0 0.08  0 0 0 -0.9 0.55" result="p" />
          <feMerge>
            <feMergeNode in="p" />
            <feMergeNode in="g" />
          </feMerge>
        </filter>

        {/* Carved relief: the shape's own edges become a lit bevel, light from the upper right. */}
        <filter id="dw-carve" x="-5%" y="-5%" width="110%" height="110%">
          <feGaussianBlur in="SourceAlpha" stdDeviation="3.2" result="blur" />
          <feDiffuseLighting in="blur" surfaceScale="5" diffuseConstant="1.15" lightingColor="#fff4dc" result="lit">
            <feDistantLight azimuth="315" elevation="38" />
          </feDiffuseLighting>
          <feComposite in="lit" in2="SourceAlpha" operator="in" result="litIn" />
          <feComposite in="SourceGraphic" in2="litIn" operator="arithmetic" k1="1.15" k2="0" k3="0" k4="0" />
        </filter>

        {/* The doorway's glow: light spilling onto the stone around it. */}
        <filter id="dw-bloom" x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="26" />
        </filter>
        <filter id="dw-soft" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="18" />
        </filter>

        {/* Filigree: small scrolls and leaves, carved into the frame bands. */}
        <pattern id="dw-filigree" width="16" height="16" patternUnits="userSpaceOnUse">
          <rect width="16" height="16" fill="#6e8462" />
          <g fill="none" stroke="#a9b48c" strokeWidth="0.8" opacity="0.6">
            <path d="M0 8L8 0L16 8L8 16Z" />
            <path d="M8 4c2 0 3 2 2 3.5S7 8 7 6.5" />
          </g>
        </pattern>
        <pattern id="dw-filigree-lit" width="16" height="16" patternUnits="userSpaceOnUse">
          <rect width="16" height="16" fill="#e6d9b3" />
          <g fill="none" stroke="#c2ad7c" strokeWidth="0.8" opacity="0.7">
            <path d="M0 8L8 0L16 8L8 16Z" />
            <path d="M8 4c2 0 3 2 2 3.5S7 8 7 6.5" />
          </g>
        </pattern>
      </defs>

      {/* The wall. */}
      <rect width="1600" height="900" fill="url(#dw-wall)" />
      <rect width="1600" height="900" filter="url(#dw-plaster)" />

      {/* Pilasters at the sides: the left in shade, the right in the sun. */}
      <g filter="url(#dw-carve)">
        <rect x="112" y="-10" width="96" height="930" fill="url(#dw-filigree)" />
        <rect x="1392" y="-10" width="96" height="930" fill="url(#dw-filigree-lit)" />
        <rect x="92" y="-10" width="12" height="930" fill="#6f8462" />
        <rect x="1496" y="-10" width="12" height="930" fill="#efe3c0" />
      </g>

      {/* Nested carved frames. */}
      <g filter="url(#dw-carve)">
        {FRAMES.map(([x, y, w, t], i) => (
          <path
            key={i}
            fillRule="evenodd"
            fill={i === 1 ? '#8f9b73' : 'url(#dw-filigree)'}
            d={`M${x} ${y}H${x + w}V960H${x}Z M${x + t} ${y + t}H${x + w - t}V960H${x + t}Z`}
          />
        ))}
      </g>

      {/* A hanging ring above the arch. */}
      <g fill="none" stroke="#2c3f31" strokeWidth="4" opacity="0.8">
        <path d="M800 54v12" />
        <circle cx="800" cy="74" r="8" />
      </g>

      {/* The arch: three stepped mouldings, then the opening. */}
      <path d={MOULD_3} fill="#7b8a66" filter="url(#dw-carve)" />
      <path d={MOULD_2} fill="url(#dw-stone-shade)" filter="url(#dw-carve)" />
      <path d={MOULD_1} fill="url(#dw-stone)" filter="url(#dw-carve)" />
      <path d={OPENING} fill="#fff6e4" filter="url(#dw-bloom)" opacity="0.95" />
      <path d={OPENING} fill="url(#dw-light)" />

      {/* The low sun: a beam across the upper right, and warm light on the right of the wall. */}
      <polygon points="1600,70 1600,330 1150,560 1150,420" fill="url(#dw-beam)" filter="url(#dw-soft)" style={{ mixBlendMode: 'screen' }} />

      {/* Haze at the edges, like light through old glass. */}
      <g style={{ mixBlendMode: 'screen' }} filter="url(#dw-soft)">
        <rect x="-40" y="-40" width="300" height="980" fill="url(#dw-haze-l)" />
        <rect x="-40" y="-40" width="520" height="980" fill="url(#dw-haze-teal)" />
        <rect x="1340" y="-40" width="300" height="980" fill="url(#dw-haze-r)" />
        <rect x="-40" y="600" width="1680" height="340" fill="url(#dw-haze-b)" />
      </g>
    </svg>
  );
}

/**
 * The landing hero: a doorway of light in a carved wall, with "hello" turning through seven of India's scripts above
 * the page's headline. The greeting stops turning on hover and for people who prefer reduced motion. Each greeting
 * carries its `lang`, so a screen reader pronounces it in that language.
 */
export function Jharokha({ children }: { children: ReactNode }) {
  const [index, setIndex] = useState(0);
  const [held, setHeld] = useState(false);

  useEffect(() => {
    if (held || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const timer = window.setInterval(() => {
      setIndex((i) => (i + 1) % GREETINGS.length);
    }, TURN_MS);
    return () => {
      window.clearInterval(timer);
    };
  }, [held]);

  const greeting = GREETINGS[index % GREETINGS.length] as Greeting;

  return (
    <div className="doorway">
      <DoorwayScene />
      <div
        className="doorway__inside"
        onPointerEnter={() => {
          setHeld(true);
        }}
        onPointerLeave={() => {
          setHeld(false);
        }}
      >
        <svg className="doorway__mark" viewBox="-20 -20 40 40" aria-hidden="true" focusable="false">
          <g fill="none" stroke="currentColor" strokeWidth="0.9">
            {[0, 45, 90, 135].map((a) => (
              <ellipse key={a} rx="16" ry="7" transform={`rotate(${a})`} />
            ))}
            <circle r="2.2" />
          </g>
        </svg>
        <p className="doorway__hello">
          <span key={greeting.lang} lang={greeting.lang} style={{ fontFamily: greeting.fontFamily }}>
            {greeting.hello}
          </span>
          <span className="visually-hidden"> (hello in {greeting.name})</span>
        </p>
        {children}
      </div>
    </div>
  );
}
