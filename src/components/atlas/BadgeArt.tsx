/**
 * Badge artwork. Drawn as inline SVG from a fixed set of shapes, so every badge can be styled from the
 * record's artwork key. Unknown keys fall back to the permanent-achievement emblem.
 */
export function BadgeArt({ artwork, label, earned = true }: { artwork: string; label: string; earned?: boolean }) {
  const ink = earned ? 'var(--accent)' : 'var(--border-strong)';
  const wash = earned ? 'var(--accent-soft)' : 'var(--well)';
  return (
    <svg viewBox="0 0 100 100" role="img" aria-label={label}>
      <circle cx="50" cy="50" r="46" fill={wash} stroke={ink} strokeWidth="2.5" />
      <circle cx="50" cy="50" r="38" fill="none" stroke={ink} strokeWidth="0.8" strokeDasharray="2 3" />
      {artwork === 'route' ? (
        <path d="M28 70 C40 40, 60 60, 72 30" fill="none" stroke={ink} strokeWidth="4" strokeLinecap="round" strokeDasharray="1 7" />
      ) : artwork === 'hands' ? (
        <path d="M30 56 Q50 30 70 56 Q50 72 30 56Z" fill="none" stroke={ink} strokeWidth="4" strokeLinejoin="round" />
      ) : artwork === 'lens' ? (
        <g fill="none" stroke={ink} strokeWidth="4"><circle cx="46" cy="46" r="14" /><path d="M57 57 L72 72" strokeLinecap="round" /></g>
      ) : artwork === 'bridge' ? (
        <path d="M24 60 Q50 30 76 60 M36 60 V70 M64 60 V70" fill="none" stroke={ink} strokeWidth="4" strokeLinecap="round" />
      ) : artwork === 'compass' ? (
        <g fill="none" stroke={ink} strokeWidth="3.5"><circle cx="50" cy="50" r="20" /><path d="M50 34 L56 50 L50 66 L44 50Z" fill={ink} stroke="none" /></g>
      ) : (
        <path d="M50 28 L60 48 L82 50 L64 62 L70 84 L50 72 L30 84 L36 62 L18 50 L40 48Z" fill="none" stroke={ink} strokeWidth="3" strokeLinejoin="round" />
      )}
    </svg>
  );
}
