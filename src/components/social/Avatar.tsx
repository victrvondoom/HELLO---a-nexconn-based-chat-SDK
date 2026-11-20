/** Initials on a soft meadow gradient (grass, sky, sun or clay). Deterministic per name, so a person always looks the same. */
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
  // Four families from the Meadow palette, picked by the name's hash: grass, sky, sun, clay.
  const families = [
    [118, 52, 88, 74],
    [205, 78, 92, 80],
    [45, 92, 90, 76],
    [16, 74, 92, 80],
  ] as const;
  const family = families[hash % families.length] ?? families[0];
  const [h, s, l1, l2] = family;
  const hue = h + ((hash >>> 3) % 12) - 6;
  return (
    <span
      className={ring ? 'avatar-lg avatar-lg--ring' : 'avatar-lg'}
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.36),
        background: `linear-gradient(135deg, hsl(${hue} ${s}% ${l1}%), hsl(${hue + 8} ${s}% ${l2}%))`,
      }}
      aria-hidden="true"
    >
      {initials}
    </span>
  );
}
