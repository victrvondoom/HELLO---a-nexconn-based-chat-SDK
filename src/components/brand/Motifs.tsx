/**
 * Jharokha motifs: rangoli flowers and the woven band. Pure SVG and CSS, drawn on the server; nothing is fetched.
 *
 * A rangoli flower is one closed path: `petals` bumps around a centre. "round" petals are the scalloped lotus of
 * floor rangoli; "point" petals curve to a tip like the arches of a jaali. Each flower is filled with a two-dye
 * gradient, the way powder colours blend at their edges.
 */

export type PetalKind = 'round' | 'point';

/** The dyes a flower can be filled with: [top, bottom]. */
export const DYES = {
  mehendi: ['#6aa83a', '#fce5b5'],
  kesar: ['#f6bc4a', '#d9861a'],
  neel: ['#3a4bb8', '#b4bdf3'],
  rani: ['#f0a3c6', '#a31c5e'],
  peacock: ['#57bed4', '#2a3896'],
  dawn: ['#b4bdf3', '#f2a516'],
} as const satisfies Record<string, readonly [string, string]>;

export type Dye = keyof typeof DYES;

const polar = (r: number, a: number) => `${(r * Math.cos(a)).toFixed(2)} ${(r * Math.sin(a)).toFixed(2)}`;

/** A closed flower outline centred on 0,0 with outer radius `r`. `inner` is the valley radius as a share of `r`. */
export function flowerPath(petals: number, r: number, inner: number, kind: PetalKind): string {
  const span = (Math.PI * 2) / petals;
  const ri = r * inner;
  const start = -Math.PI / 2 - span / 2;
  let d = `M${polar(ri, start)}`;
  for (let i = 0; i < petals; i += 1) {
    const a0 = start + i * span;
    const a1 = a0 + span;
    if (kind === 'round') {
      d += ` C${polar(r * 1.2, a0 + span * 0.12)} ${polar(r * 1.2, a1 - span * 0.12)} ${polar(ri, a1)}`;
    } else {
      const mid = a0 + span / 2;
      d += ` C${polar((ri + r) * 0.62, a0 + span * 0.08)} ${polar(r * 0.78, mid - span * 0.06)} ${polar(r, mid)}`;
      d += ` C${polar(r * 0.78, mid + span * 0.06)} ${polar((ri + r) * 0.62, a1 - span * 0.08)} ${polar(ri, a1)}`;
    }
  }
  return `${d}Z`;
}

export function Rangoli({
  id,
  petals = 8,
  kind = 'round',
  inner = 0.68,
  dye = 'kesar',
  size = 64,
  rotate = 0,
  className,
}: {
  /** Unique on the page: it names the gradient. */
  id: string;
  petals?: number;
  kind?: PetalKind;
  inner?: number;
  dye?: Dye;
  size?: number;
  rotate?: number;
  className?: string;
}) {
  const [top, bottom] = DYES[dye];
  const outline = flowerPath(petals, 46, inner, kind);
  return (
    <svg
      className={className ? `rangoli ${className}` : 'rangoli'}
      viewBox="-50 -50 100 100"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0.05" stopColor={top} />
          <stop offset="0.95" stopColor={bottom} />
        </linearGradient>
      </defs>
      <g transform={rotate ? `rotate(${rotate})` : undefined}>
        <path d={outline} fill={`url(#${id})`} />
        <path d={flowerPath(petals, 30, inner, kind)} fill="#fff" opacity="0.16" />
        <circle r="5" fill="#fff" opacity="0.55" />
      </g>
    </svg>
  );
}

/** The woven band: a strip of block-printed border. Decoration only, so it is hidden from assistive technology. */
export function Weave({ className }: { className?: string }) {
  return <div className={className ? `weave ${className}` : 'weave'} aria-hidden="true" />;
}

const LOTUS_TILE = flowerPath(8, 11.5, 0.55, 'point');

/**
 * The lotus tile: a rangoli lotus on indigo, the centre of the HELLO mark. Solid fills and no ids, so any number of
 * copies can share a page, including copies inside hidden elements.
 */
export function Lotus({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="-16 -16 32 32" aria-hidden="true" focusable="false">
      <circle r="16" fill="#1f2a78" />
      <circle r="13.5" fill="#2a3896" />
      <path d={LOTUS_TILE} fill="#f9d27f" />
      <circle r="2.8" fill="#d6337f" />
    </svg>
  );
}

/**
 * A blue-pottery medallion: a hand-painted rim around the lotus tile, like a Jaipur plate on a wall.
 */
export function Medallion({ size = 112, className }: { size?: number; className?: string }) {
  return (
    <span className={className ? `medallion ${className}` : 'medallion'} style={{ width: size, height: size }} aria-hidden="true">
      <Lotus className="medallion__lotus" />
    </span>
  );
}
