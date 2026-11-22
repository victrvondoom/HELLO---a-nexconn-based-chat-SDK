/**
 * A small ghat at dawn: the sky going from indigo through rani to saffron, a low sun, a row of chhatris (domed
 * pavilions) along the bank, and steps down to the water. Drawn inline so it needs no image request. Decorative only.
 * `id` keeps gradient ids unique when the scene appears twice on one page.
 */
export function Ghat({ id = 'ghat', className }: { id?: string; className?: string }) {
  const sky = `${id}-sky`;
  const water = `${id}-water`;
  // One chhatri: a plinth, two pillars, a dome and a finial. `x` is its centre, `s` its scale.
  const chhatri = (x: number, s: number) =>
    `M${x - 9 * s} 74 h${18 * s} v-3 h${-2 * s} v${-9 * s} h${-2 * s} v${9 * s} h${-10 * s} v${-9 * s} h${-2 * s} v${9 * s} h${-2 * s} Z ` +
    `M${x - 9 * s} ${74 - 12 * s} h${18 * s} C${x + 9 * s} ${74 - 22 * s} ${x + 2 * s} ${74 - 24 * s} ${x} ${74 - 28 * s} ` +
    `C${x - 2 * s} ${74 - 24 * s} ${x - 9 * s} ${74 - 22 * s} ${x - 9 * s} ${74 - 12 * s} Z`;
  return (
    <svg className={className ? `ghat ${className}` : 'ghat'} viewBox="0 0 240 120" preserveAspectRatio="xMidYMax slice" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={sky} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#2a3896" />
          <stop offset="0.38" stopColor="#6a4fb0" />
          <stop offset="0.66" stopColor="#d6337f" />
          <stop offset="0.9" stopColor="#f6bc4a" />
        </linearGradient>
        <linearGradient id={water} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#3a4bb8" />
          <stop offset="1" stopColor="#18205c" />
        </linearGradient>
      </defs>
      <rect width="240" height="120" fill={`url(#${sky})`} />
      <circle cx="176" cy="58" r="13" fill="#fce5b5" opacity="0.95" />
      <g fill="#18205c">
        <rect x="0" y="74" width="240" height="8" />
        <path d={chhatri(34, 1)} />
        <path d={chhatri(70, 0.75)} />
        <path d={chhatri(212, 1.1)} />
      </g>
      <g fill="#10153f">
        <rect x="0" y="82" width="240" height="4" opacity="0.9" />
        <rect x="0" y="88" width="240" height="4" opacity="0.8" />
        <rect x="0" y="94" width="240" height="4" opacity="0.7" />
      </g>
      <rect x="0" y="100" width="240" height="20" fill={`url(#${water})`} />
      <path d="M150 106 h50 M164 112 h26" stroke="#f9d27f" strokeWidth="1.4" strokeLinecap="round" opacity="0.7" />
    </svg>
  );
}
