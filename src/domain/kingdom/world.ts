/**
 * The shape of a kingdom. Pure: no storage, no clock. The terrain and the street plan are functions of the
 * seed, so a kingdom is a few numbers in the database, the browser and the server always agree on it, and a
 * citizen's home is just a lot index that never changes.
 */

export const WORLD_SIZE = 48;
export const SEA_LEVEL = 2;
export const MAX_HEIGHT = 7;
/** The plaza and keep at the centre. Nobody builds a home on it. */
export const PLAZA_RADIUS = 4;
export const MAX_CITIZENS = 96;
/** The furthest a citizen can walk in one step, in tiles. Longer moves are refused, not clamped. */
export const MAX_STEP = 3;

export type Terrain = 'WATER' | 'SAND' | 'GRASS' | 'ROCK';

export interface Tile {
  x: number;
  z: number;
  height: number;
  terrain: Terrain;
}

function hash(seed: number, x: number, z: number): number {
  let h = (seed ^ Math.imul(x, 374761393) ^ Math.imul(z, 668265263)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

function valueNoise(seed: number, x: number, z: number, cell: number): number {
  const gx = x / cell;
  const gz = z / cell;
  const x0 = Math.floor(gx);
  const z0 = Math.floor(gz);
  const fx = smooth(gx - x0);
  const fz = smooth(gz - z0);
  const a = hash(seed, x0, z0);
  const b = hash(seed, x0 + 1, z0);
  const c = hash(seed, x0, z0 + 1);
  const d = hash(seed, x0 + 1, z0 + 1);
  return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
}

export function inBounds(x: number, z: number): boolean {
  return Number.isInteger(x) && Number.isInteger(z) && x >= 0 && z >= 0 && x < WORLD_SIZE && z < WORLD_SIZE;
}

/** The tile at (x, z). The centre is held level and green; the rim falls away into water. */
export function tileAt(seed: number, x: number, z: number): Tile {
  const centre = (WORLD_SIZE - 1) / 2;
  const dist = Math.hypot(x - centre, z - centre);
  const island = Math.max(0, 1 - Math.pow(dist / (WORLD_SIZE * 0.5), 2.2));
  const noise = valueNoise(seed, x, z, 9) * 0.65 + valueNoise(seed ^ 0x9e3779b1, x, z, 4) * 0.35;
  let height = Math.round((noise * 0.45 + island * 0.55) * MAX_HEIGHT);
  // Around the keep the land is always green and gently rolling (never sand, water or rock), so the gate,
  // the plaza and the first streets are always walkable whatever the seed. Rock only rises further out.
  if (dist <= PLAZA_RADIUS + 9) height = Math.min(SEA_LEVEL + 4, Math.max(height, SEA_LEVEL + 2));
  if (dist <= PLAZA_RADIUS + 1) height = SEA_LEVEL + 2;
  height = Math.max(0, Math.min(MAX_HEIGHT, height));
  const terrain: Terrain = height <= SEA_LEVEL ? 'WATER' : height === SEA_LEVEL + 1 ? 'SAND' : height >= SEA_LEVEL + 5 ? 'ROCK' : 'GRASS';
  return { x, z, height, terrain };
}

export function isWalkable(seed: number, x: number, z: number): boolean {
  if (!inBounds(x, z)) return false;
  const t = tileAt(seed, x, z).terrain;
  return t === 'GRASS' || t === 'SAND';
}

export interface Lot {
  index: number;
  x: number;
  z: number;
}

/**
 * The street plan: every third tile on a grid, outside the plaza, on grass, nearest the centre first. The
 * order is fixed by the seed alone, so lot 7 is the same place for everyone, forever.
 */
export function streetPlan(seed: number): Lot[] {
  const centre = (WORLD_SIZE - 1) / 2;
  const candidates: Array<{ x: number; z: number; d: number }> = [];
  for (let x = 2; x < WORLD_SIZE - 2; x += 3) {
    for (let z = 2; z < WORLD_SIZE - 2; z += 3) {
      const d = Math.hypot(x - centre, z - centre);
      if (d <= PLAZA_RADIUS + 2) continue;
      if (tileAt(seed, x, z).terrain !== 'GRASS') continue;
      candidates.push({ x, z, d });
    }
  }
  candidates.sort((a, b) => a.d - b.d || a.x - b.x || a.z - b.z);
  return candidates.slice(0, MAX_CITIZENS).map((c, index) => ({ index, x: c.x, z: c.z }));
}

export const ROOF_COLOURS = ['#c2410c', '#1d4ed8', '#15803d', '#a21caf', '#b45309', '#0e7490', '#be123c', '#4d7c0f'] as const;

export interface Home {
  lot: number;
  x: number;
  z: number;
  roof: string;
  storeys: 1 | 2 | 3;
}

/** A home is derived from its lot: citizens do not design it, so no two edits can disagree. */
export function homeFor(seed: number, lot: number): Home | null {
  const spot = streetPlan(seed)[lot];
  if (!spot) return null;
  const roll = hash(seed, spot.x, spot.z);
  return { lot, x: spot.x, z: spot.z, roof: ROOF_COLOURS[Math.floor(roll * ROOF_COLOURS.length) % ROOF_COLOURS.length] ?? ROOF_COLOURS[0], storeys: roll > 0.8 ? 3 : roll > 0.45 ? 2 : 1 };
}

/** The first lot nobody holds, or null when the kingdom is full. */
export function nextFreeLot(seed: number, taken: ReadonlySet<number>): number | null {
  for (const lot of streetPlan(seed)) if (!taken.has(lot.index)) return lot.index;
  return null;
}

/** The gate: where newcomers and caravans arrive. South edge of the plaza. */
export function gatePosition(): { x: number; z: number } {
  const centre = Math.round((WORLD_SIZE - 1) / 2);
  return { x: centre, z: centre + PLAZA_RADIUS + 1 };
}

/** Whether a walk from one tile to another is allowed: the target is walkable and not further than MAX_STEP. */
export function canStep(seed: number, from: { x: number; z: number }, to: { x: number; z: number }): boolean {
  if (!isWalkable(seed, to.x, to.z)) return false;
  return Math.max(Math.abs(to.x - from.x), Math.abs(to.z - from.z)) <= MAX_STEP;
}
