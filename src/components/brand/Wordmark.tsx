/**
 * The HELLO wordmark, drawn as rounded strokes rather than set in a font, so it looks the same
 * everywhere. The O is a halo ring with a small diamond inside it, and sky blue flows through
 * the letters. `id` keeps gradient ids unique when the mark appears twice on one page.
 */
export function Wordmark({
  height = 32,
  id = 'wm',
  title = 'HELLO',
  className,
}: {
  height?: number;
  id?: string;
  title?: string;
  className?: string;
}) {
  const flow = `${id}-flow`;
  const ring = `${id}-ring`;
  const gem = `${id}-gem`;
  return (
    <svg
      className={className ? `wordmark ${className}` : 'wordmark'}
      viewBox="0 0 240 72"
      height={height}
      width={(height * 240) / 72}
      role="img"
      aria-label={title}
      focusable="false"
    >
      <defs>
        <linearGradient id={flow} x1="0" y1="0" x2="240" y2="0" gradientUnits="userSpaceOnUse" spreadMethod="reflect">
          <stop offset="0" stopColor="#0284c7" />
          <stop offset="0.35" stopColor="#0ea5e9" />
          <stop offset="0.6" stopColor="#38bdf8" />
          <stop offset="0.8" stopColor="#7dd3fc" />
          <stop offset="1" stopColor="#0ea5e9" />
          <animateTransform attributeName="gradientTransform" type="translate" values="0 0;240 0;0 0" dur="9s" repeatCount="indefinite" />
        </linearGradient>
        <linearGradient id={ring} x1="168" y1="10" x2="232" y2="64" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#bae6fd" />
          <stop offset="0.45" stopColor="#38bdf8" />
          <stop offset="1" stopColor="#0284c7" />
          <animateTransform attributeName="gradientTransform" type="rotate" values="0 200 37;360 200 37" dur="7s" repeatCount="indefinite" />
        </linearGradient>
        <linearGradient id={gem} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.5" stopColor="#e0f2fe" />
          <stop offset="1" stopColor="#7dd3fc" />
        </linearGradient>
      </defs>

      <g fill="none" stroke={`url(#${flow})`} strokeWidth="11" strokeLinecap="round" strokeLinejoin="round">
        {/* H: gently bowed stems and a smiling crossbar */}
        <path d="M17 14 Q13 37 17 60" />
        <path d="M47 14 Q51 37 47 60" />
        <path d="M17 39 Q32 31 47 39" />
        {/* E: one curl with a bar, like a soft epsilon */}
        <path d="M90 18 Q83 13 76 13 Q62 13 62 26 Q62 36 74 37 Q60 38 60 49 Q60 61 76 61 Q85 61 91 55" />
        {/* L L: stems that roll into their feet */}
        <path d="M107 12 V46 Q107 60 121 60 H127" />
        <path d="M141 12 V46 Q141 60 155 60 H161" />
      </g>

      {/* O: the halo. A back arc, a diamond, then the front arc, so the gem sits inside the ring. */}
      <g className="wordmark__halo">
        <ellipse cx="200" cy="37" rx="25" ry="24" fill="none" stroke={`url(#${ring})`} strokeWidth="11" />
        <g className="wordmark__gem">
          <path d="M200 26 L208 34 L200 48 L192 34 Z" fill={`url(#${gem})`} stroke="#38bdf8" strokeWidth="1.2" strokeLinejoin="round" />
          <path d="M192 34 H208 M200 26 L197 34 L200 48 L203 34 Z" fill="none" stroke="#7dd3fc" strokeWidth="0.9" strokeLinejoin="round" />
        </g>
        <path className="wordmark__glint" d="M222 8 l1.6 4.4 4.4 1.6 -4.4 1.6 -1.6 4.4 -1.6 -4.4 -4.4 -1.6 4.4 -1.6z" fill="#7dd3fc" />
      </g>
    </svg>
  );
}

/** A compact halo mark (ring and gem) for avatars and small spaces. Pure CSS, so it costs nothing to render. */
export function HaloMark({ size = 32, className }: { size?: number; className?: string }) {
  return (
    <span className={className ? `halo-mark ${className}` : 'halo-mark'} style={{ width: size, height: size }} aria-hidden="true">
      <span className="halo-mark__ring" />
      <span className="halo-mark__gem" />
    </span>
  );
}
