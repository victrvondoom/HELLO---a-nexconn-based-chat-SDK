'use client';

import { useEffect, useMemo, useRef } from 'react';
import { MAX_HEIGHT, SEA_LEVEL, tileAt, WORLD_SIZE, type Terrain } from '@/domain/kingdom/world';
import type { KingdomView } from '@/services/kingdoms';

/**
 * An isometric voxel view of a kingdom on a 2D canvas: no WebGL, no asset downloads, nothing heavier than a few
 * thousand rectangles. The terrain is recomputed from the seed in the browser (the same function the server uses
 * to check walks), then cached to an offscreen canvas, so a frame only draws people and things on top of it.
 * Clicking a tile reports it; the parent decides whether that means walking or placing something.
 */

const TILE_W = 22;
const TILE_H = 11;
const STEP = 5;

const TOP: Record<Terrain, string> = { WATER: '#3b82c4', SAND: '#e2c98a', GRASS: '#5aa646', ROCK: '#8b8f98' };
const SIDE: Record<Terrain, string> = { WATER: '#2b66a0', SAND: '#b99f68', GRASS: '#3f7d32', ROCK: '#686c75' };

const KIT_GLYPH: Record<string, string> = { TREE: '🌳', LANTERN: '🏮', FOUNTAIN: '⛲', STATUE: '🗿', BANNER: '🚩', BENCH: '🪑', GARDEN: '🌷', TOWER: '🏰', MARKET: '🧺', CAMPFIRE: '🔥' };

export interface Placed {
  x: number;
  z: number;
}

function project(x: number, z: number, h: number, originX: number, originY: number) {
  return { sx: originX + (x - z) * (TILE_W / 2), sy: originY + (x + z) * (TILE_H / 2) - h * STEP };
}

function drawBlock(g: CanvasRenderingContext2D, sx: number, sy: number, top: string, side: string, depth: number) {
  g.fillStyle = top;
  g.beginPath();
  g.moveTo(sx, sy);
  g.lineTo(sx + TILE_W / 2, sy + TILE_H / 2);
  g.lineTo(sx, sy + TILE_H);
  g.lineTo(sx - TILE_W / 2, sy + TILE_H / 2);
  g.closePath();
  g.fill();
  if (depth <= 0) return;
  g.fillStyle = side;
  g.beginPath();
  g.moveTo(sx - TILE_W / 2, sy + TILE_H / 2);
  g.lineTo(sx, sy + TILE_H);
  g.lineTo(sx, sy + TILE_H + depth);
  g.lineTo(sx - TILE_W / 2, sy + TILE_H / 2 + depth);
  g.closePath();
  g.fill();
  g.globalAlpha = 0.8;
  g.beginPath();
  g.moveTo(sx + TILE_W / 2, sy + TILE_H / 2);
  g.lineTo(sx, sy + TILE_H);
  g.lineTo(sx, sy + TILE_H + depth);
  g.lineTo(sx + TILE_W / 2, sy + TILE_H / 2 + depth);
  g.closePath();
  g.fill();
  g.globalAlpha = 1;
}

export function KingdomWorld({ view, onTile }: { view: KingdomView; onTile: (tile: Placed) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const seed = view.kingdom?.seed ?? 0;
  const width = WORLD_SIZE * TILE_W;
  const height = WORLD_SIZE * TILE_H + MAX_HEIGHT * STEP + 60;
  const originX = width / 2;
  const originY = MAX_HEIGHT * STEP + 24;

  // The terrain never changes for a seed, so it is drawn once and reused every time people or things move.
  const terrain = useMemo(() => {
    if (typeof document === 'undefined') return null;
    const layer = document.createElement('canvas');
    layer.width = width;
    layer.height = height;
    const g = layer.getContext('2d');
    if (!g) return null;
    for (let s = 0; s < WORLD_SIZE * 2 - 1; s += 1) {
      for (let x = 0; x < WORLD_SIZE; x += 1) {
        const z = s - x;
        if (z < 0 || z >= WORLD_SIZE) continue;
        const tile = tileAt(seed, x, z);
        const level = tile.terrain === 'WATER' ? SEA_LEVEL : tile.height;
        const { sx, sy } = project(x, z, level, originX, originY);
        drawBlock(g, sx, sy, TOP[tile.terrain], SIDE[tile.terrain], Math.max(2, level * STEP * 0.6));
      }
    }
    return layer;
  }, [seed, width, height, originX, originY]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const g = canvas?.getContext('2d');
    if (!canvas || !g || !terrain) return;
    g.clearRect(0, 0, width, height);
    g.drawImage(terrain, 0, 0);
    const level = (x: number, z: number) => {
      const t = tileAt(seed, x, z);
      return t.terrain === 'WATER' ? SEA_LEVEL : t.height;
    };
    // Back to front, so nearer things cover further ones.
    type Item = { depth: number; draw: () => void };
    const items: Item[] = [];
    for (const c of view.citizens) {
      if (!c.home) continue;
      const home = c.home;
      items.push({
        depth: home.x + home.z,
        draw: () => {
          const { sx, sy } = project(home.x, home.z, level(home.x, home.z), originX, originY);
          for (let i = 0; i < home.storeys; i += 1) drawBlock(g, sx, sy - i * 7, i === home.storeys - 1 ? home.roof : '#e7dcc4', '#bfb293', 7);
        },
      });
    }
    const centre = Math.round((WORLD_SIZE - 1) / 2);
    const keepAt = project(centre, centre, level(centre, centre), originX, originY);
    items.push({
      depth: centre * 2,
      draw: () => {
        for (let i = 0; i < 4; i += 1) drawBlock(g, keepAt.sx, keepAt.sy - i * 8, i === 3 ? '#b91c1c' : '#cbd5e1', '#94a3b8', 8);
      },
    });
    for (const f of view.forges) {
      if (f.status !== 'APPROVED') continue;
      items.push({
        depth: f.x + f.z + 0.1,
        draw: () => {
          const { sx, sy } = project(f.x, f.z, level(f.x, f.z), originX, originY);
          g.font = '14px sans-serif';
          g.textAlign = 'center';
          g.fillText(KIT_GLYPH[f.kit] ?? '✨', sx, sy + 2);
        },
      });
    }
    for (const c of view.citizens) {
      if (c.banned) continue;
      items.push({
        depth: c.x + c.z + 0.5,
        draw: () => {
          const { sx, sy } = project(c.x, c.z, level(c.x, c.z), originX, originY);
          g.fillStyle = c.isYou ? '#f59e0b' : c.isMonarch ? '#dc2626' : '#1f2937';
          g.beginPath();
          g.arc(sx, sy + TILE_H / 2 - 5, c.isYou ? 4.5 : 3.5, 0, Math.PI * 2);
          g.fill();
          g.strokeStyle = '#ffffff';
          g.lineWidth = 1.2;
          g.stroke();
          g.fillStyle = '#111827';
          g.font = '10px sans-serif';
          g.textAlign = 'center';
          g.fillText(c.name.slice(0, 14), sx, sy - 6);
        },
      });
    }
    for (const item of items.sort((a, b) => a.depth - b.depth)) item.draw();
  }, [view.citizens, view.forges, terrain, seed, width, height, originX, originY]);

  const click = (event: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const px = ((event.clientX - rect.left) / rect.width) * width;
    const py = ((event.clientY - rect.top) / rect.height) * height;
    // The tile whose top face centre is nearest the click.
    let best: Placed | null = null;
    let bestDist = Infinity;
    for (let x = 0; x < WORLD_SIZE; x += 1) {
      for (let z = 0; z < WORLD_SIZE; z += 1) {
        const t = tileAt(seed, x, z);
        const { sx, sy } = project(x, z, t.terrain === 'WATER' ? SEA_LEVEL : t.height, originX, originY);
        const d = Math.hypot(px - sx, py - (sy + TILE_H / 2));
        if (d < bestDist) {
          bestDist = d;
          best = { x, z };
        }
      }
    }
    if (best && bestDist < TILE_W) onTile(best);
  };

  const label = `Kingdom map with ${view.citizens.length} citizens and ${view.forges.filter((f) => f.status === 'APPROVED').length} forged things. Use the controls beside it to walk.`;
  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      onClick={click}
      role="img"
      aria-label={label}
      style={{ width: '100%', maxWidth: width, height: 'auto', background: '#cfe8f7', borderRadius: 12, cursor: 'pointer', touchAction: 'manipulation' }}
    />
  );
}
