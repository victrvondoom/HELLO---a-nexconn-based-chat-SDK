import { flowerPath, Lotus } from './Motifs';

const LOTUS = flowerPath(8, 11.5, 0.55, 'point');

/**
 * The HELLO wordmark, drawn as rounded strokes rather than set in a font, so it looks the same
 * everywhere. The letters are an indigo thread that slowly takes up rani pink, like cloth in a dye vat;
 * the O is a saffron ring around a rangoli lotus on an indigo tile: the Jharokha design in one mark.
 * `id` keeps gradient ids unique when the mark appears twice on one page.
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
          <stop offset="0" stopColor="#2a3896" />
          <stop offset="0.4" stopColor="#3a4bb8" />
          <stop offset="0.62" stopColor="#2a3896" />
          <stop offset="0.86" stopColor="#a31c5e" />
          <stop offset="1" stopColor="#2a3896" />
          <animateTransform attributeName="gradientTransform" type="translate" values="0 0;240 0;0 0" dur="12s" repeatCount="indefinite" />
        </linearGradient>
        <linearGradient id={ring} x1="168" y1="10" x2="232" y2="64" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#f9d27f" />
          <stop offset="0.45" stopColor="#f2a516" />
          <stop offset="1" stopColor="#d6337f" />
          <animateTransform attributeName="gradientTransform" type="rotate" values="0 200 37;360 200 37" dur="9s" repeatCount="indefinite" />
        </linearGradient>
        <linearGradient id={gem} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#3a4bb8" />
          <stop offset="1" stopColor="#18205c" />
        </linearGradient>
        <clipPath id={`${id}-horizon`}>
          <circle cx="200" cy="37" r="14.5" />
        </clipPath>
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

      {/* O: a saffron ring around a rangoli lotus on indigo. */}
      <g className="wordmark__halo">
        <ellipse cx="200" cy="37" rx="25" ry="24" fill="none" stroke={`url(#${ring})`} strokeWidth="11" />
        <g className="wordmark__gem" clipPath={`url(#${id}-horizon)`}>
          <rect x="184" y="21" width="32" height="32" fill={`url(#${gem})`} />
          <path d={LOTUS} transform="translate(200 37)" fill="#f9d27f" />
          <circle cx="200" cy="37" r="2.6" fill="#d6337f" />
        </g>
        <path className="wordmark__glint" d="M222 8 l1.6 4.4 4.4 1.6 -4.4 1.6 -1.6 4.4 -1.6 -4.4 -4.4 -1.6 4.4 -1.6z" fill="#f2a516" />
      </g>
    </svg>
  );
}

/** A compact mark (saffron ring and lotus tile) for avatars and small spaces. Inline, so it costs no request. */
export function HaloMark({ size = 32, className }: { size?: number; className?: string }) {
  return (
    <span className={className ? `halo-mark ${className}` : 'halo-mark'} style={{ width: size, height: size }} aria-hidden="true">
      <span className="halo-mark__ring" />
      <Lotus className="halo-mark__gem" />
    </span>
  );
}
