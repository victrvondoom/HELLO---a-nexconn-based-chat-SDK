/** Initials on a soft sky gradient. Deterministic per name, so a person always looks the same. */
export function Avatar({ name, size = 40, ring = false }: { name: string; size?: number; ring?: boolean }) {
  const clean = name
    .replace(/\(.*?\)/g, '')
    .replace(/^(dr|prof|mr|mrs|ms|mx)\.?\s+/i, '')
    .trim();
  const initials = clean
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p.charAt(0).toUpperCase())
    .join('');
  let hash = 0;
  for (const ch of clean) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  const hue = 190 + (hash % 40); // stays in the sky family
  return (
    <span
      className={ring ? 'avatar-lg avatar-lg--ring' : 'avatar-lg'}
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.36),
        background: `linear-gradient(135deg, hsl(${hue} 95% 94%), hsl(${hue + 8} 90% 82%))`,
      }}
      aria-hidden="true"
    >
      {initials}
    </span>
  );
}
