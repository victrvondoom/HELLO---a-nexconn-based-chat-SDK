/**
 * Small meadow scenery: layered hills under a sky, a lone tree and a walker on the path. It is the
 * "home" motif from the design brief, drawn inline so it needs no image request. Decorative only.
 * `id` keeps gradient ids unique when the scene appears twice on one page.
 */
export function Hills({ id = 'hills', className }: { id?: string; className?: string }) {
  const sky = `${id}-sky`;
  const far = `${id}-far`;
  const mid = `${id}-mid`;
  const near = `${id}-near`;
  return (
    <svg className={className ? `hills ${className}` : 'hills'} viewBox="0 0 240 120" preserveAspectRatio="xMidYMax slice" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={sky} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#6fb6ea" />
          <stop offset="0.55" stopColor="#bfe1f7" />
          <stop offset="1" stopColor="#eef5ec" />
        </linearGradient>
        <linearGradient id={far} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#9ccf86" />
          <stop offset="1" stopColor="#7cb86a" />
        </linearGradient>
        <linearGradient id={mid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#6db658" />
          <stop offset="1" stopColor="#3f9445" />
        </linearGradient>
        <linearGradient id={near} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#3f9445" />
          <stop offset="1" stopColor="#1f6f35" />
        </linearGradient>
      </defs>
      <rect width="240" height="120" fill={`url(#${sky})`} />
      <circle className="hills__sun" cx="186" cy="30" r="12" fill="#f9df86" />
      <g className="hills__clouds" fill="#ffffff" opacity="0.85">
        <ellipse cx="54" cy="26" rx="18" ry="5" />
        <ellipse cx="66" cy="22" rx="10" ry="5" />
        <ellipse cx="140" cy="16" rx="12" ry="3.5" />
      </g>
      <path d="M0 74 C40 58 80 60 120 70 C160 80 200 62 240 66 V120 H0 Z" fill={`url(#${far})`} />
      <path d="M0 88 C30 72 70 70 110 82 C150 94 190 76 240 80 V120 H0 Z" fill={`url(#${mid})`} />
      <g className="hills__tree">
        <path d="M168 79 C168 74 167.6 70 167 66" stroke="#4a3a24" strokeWidth="2" strokeLinecap="round" fill="none" />
        <circle cx="164" cy="62" r="7.5" fill="#2f7d3a" />
        <circle cx="171" cy="60" r="8" fill="#3a8c41" />
        <circle cx="168" cy="55" r="7" fill="#4aa04b" />
      </g>
      <path d="M0 100 C50 88 100 90 140 98 C180 106 210 96 240 96 V120 H0 Z" fill={`url(#${near})`} />
      <path d="M96 120 C104 108 120 100 150 96" stroke="#d9c9a3" strokeWidth="3" fill="none" strokeLinecap="round" opacity="0.9" />
      <g className="hills__walker" transform="translate(126 92)">
        <circle cx="0" cy="-7" r="1.4" fill="#4a3a24" />
        <path d="M-1.3 -5.6 h2.6 v4.2 h-2.6z" fill="#ffffff" />
        <path d="M-1.1 -1.4 l-0.6 3.4 M1.1 -1.4 l0.6 3.4" stroke="#1565a8" strokeWidth="1.2" strokeLinecap="round" />
      </g>
    </svg>
  );
}
