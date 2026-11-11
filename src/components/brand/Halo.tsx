'use client';

import { useEffect, useRef } from 'react';

/**
 * The HELLO halo: a 3D ring of light with a cut diamond turning inside it, drawn on a canvas.
 *
 * The ring is a torus of points, lit and depth-sorted each frame; sky blue flows around it.
 * The gem is a brilliant cut (table, crown and pavilion facets) with flat shading. Points behind
 * the gem are drawn before it and points in front after it, so the gem sits inside the ring.
 *
 * It renders a single still frame when the viewer prefers reduced motion, and pauses whenever it
 * is off screen or the tab is hidden.
 */

type Vec = [number, number, number];

const RING_U = 132;
const RING_V = 22;
const R_MAJOR = 1;
const R_MINOR = 0.13;
const CAMERA = 4.2;
const LIGHT: Vec = normalise([-0.45, -0.75, -0.55]);

function normalise(v: Vec): Vec {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

function rotate(v: Vec, ax: number, ay: number, az: number): Vec {
  let [x, y, z] = v;
  // Y (spin), then X (tilt towards the viewer), then Z (a slow wobble).
  let c = Math.cos(ay);
  let s = Math.sin(ay);
  [x, z] = [x * c + z * s, -x * s + z * c];
  c = Math.cos(ax);
  s = Math.sin(ax);
  [y, z] = [y * c - z * s, y * s + z * c];
  c = Math.cos(az);
  s = Math.sin(az);
  [x, y] = [x * c - y * s, x * s + y * c];
  return [x, y, z];
}

const dot = (a: Vec, b: Vec) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Sky palette, from deep to ice. */
const SKY: Array<[number, number, number]> = [
  [2, 132, 199],
  [14, 165, 233],
  [56, 189, 248],
  [125, 211, 252],
  [186, 230, 253],
];

const DEEP: [number, number, number] = [2, 132, 199];
const ORIGIN: Vec = [0, 0, 0];

/** Index into a vertex list without a non-null assertion; face indices are built in range. */
const vertex = (list: readonly Vec[], index: number | undefined): Vec => (index === undefined ? ORIGIN : (list[index] ?? ORIGIN));

function sky(t: number): [number, number, number] {
  const x = ((t % 1) + 1) % 1;
  const p = x < 0.5 ? x * 2 : (1 - x) * 2; // there and back, so the flow has no seam
  const f = p * (SKY.length - 1);
  const i = Math.min(SKY.length - 2, Math.floor(f));
  const k = f - i;
  const a = SKY[i] ?? DEEP;
  const b = SKY[i + 1] ?? DEEP;
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
}

interface RingPoint {
  u: number;
  p: Vec;
  n: Vec;
}

function buildRing(): RingPoint[] {
  const pts: RingPoint[] = [];
  for (let i = 0; i < RING_U; i++) {
    const u = (i / RING_U) * Math.PI * 2;
    for (let j = 0; j < RING_V; j++) {
      const v = (j / RING_V) * Math.PI * 2;
      const cu = Math.cos(u);
      const su = Math.sin(u);
      const cv = Math.cos(v);
      const sv = Math.sin(v);
      pts.push({
        u: i / RING_U,
        p: [(R_MAJOR + R_MINOR * cv) * cu, R_MINOR * sv, (R_MAJOR + R_MINOR * cv) * su],
        n: [cv * cu, sv, cv * su],
      });
    }
  }
  return pts;
}

/** A brilliant-cut gem: table octagon, crown quads and pavilion triangles meeting at the culet. */
function buildGem(): { verts: Vec[]; faces: number[][] } {
  const sides = 8;
  const verts: Vec[] = [];
  const table = 0.5;
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * Math.PI * 2 + Math.PI / sides;
    verts.push([Math.cos(a) * table, -0.3, Math.sin(a) * table]);
  }
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * Math.PI * 2;
    verts.push([Math.cos(a), 0, Math.sin(a)]);
  }
  verts.push([0, 1.05, 0]);
  const culet = verts.length - 1;
  const faces: number[][] = [];
  faces.push([...Array(sides).keys()].reverse());
  for (let i = 0; i < sides; i++) {
    const n = (i + 1) % sides;
    faces.push([i, n, sides + n]);
    faces.push([i, sides + n, sides + i]);
    faces.push([sides + i, sides + n, culet]);
  }
  return { verts, faces };
}

export function Halo({ className, label = 'An animated halo of sky-blue light around a turning diamond.' }: { className?: string; label?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    const ring = buildRing();
    const gem = buildGem();
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let width = 0;
    let height = 0;
    let dpr = 1;
    let frame = 0;
    let visible = true;
    let running = false;
    const start = performance.now();

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      dpr = Math.min(2, window.devicePixelRatio || 1);
      width = Math.max(1, rect.width);
      height = Math.max(1, rect.height);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const draw = (time: number) => {
      const t = (time - start) / 1000;
      const scale = Math.min(width, height) * 0.36;
      const cx = width / 2;
      const cy = height / 2;
      const spin = t * 0.5;
      const tilt = 0.98 + Math.sin(t * 0.45) * 0.07;
      const wobble = Math.sin(t * 0.3) * 0.16;
      ctx.clearRect(0, 0, width, height);

      const project = (v: Vec): [number, number, number] => {
        const f = CAMERA / (CAMERA + v[2]);
        return [cx + v[0] * scale * f, cy + v[1] * scale * f, f];
      };

      type Dot = { x: number; y: number; z: number; r: number; c: string };
      const back: Dot[] = [];
      const front: Dot[] = [];
      for (const pt of ring) {
        const p = rotate(pt.p, tilt, spin, wobble);
        const n = rotate(pt.n, tilt, spin, wobble);
        const diffuse = Math.max(0, -dot(n, LIGHT));
        const half = normalise([-LIGHT[0], -LIGHT[1], -LIGHT[2] - 1]);
        const spec = Math.pow(Math.max(0, -dot(n, [-half[0], -half[1], -half[2]])), 28);
        const [x, y, f] = project(p);
        const [r, g, b] = sky(pt.u * 2 - t * 0.18);
        const shade = 0.55 + 0.45 * diffuse;
        const mix = (ch: number) => Math.round(Math.min(255, ch * shade + (255 - ch * shade) * spec * 0.9));
        const alpha = 0.35 + 0.55 * (1 - (p[2] + 1.2) / 2.4);
        const d: Dot = { x, y, z: p[2], r: (0.9 + diffuse * 1.4 + spec * 1.6) * f * (scale / 150), c: `rgba(${mix(r)},${mix(g)},${mix(b)},${alpha.toFixed(3)})` };
        (p[2] > 0 ? back : front).push(d);
      }
      back.sort((a, b) => b.z - a.z);
      front.sort((a, b) => b.z - a.z);

      const paint = (dots: Dot[]) => {
        for (const d of dots) {
          ctx.fillStyle = d.c;
          ctx.beginPath();
          ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
          ctx.fill();
        }
      };

      paint(back);

      // The gem bobs gently and turns on its own axis, slower than the ring.
      const bob = Math.sin(t * 1.1) * 0.05;
      const gs = 0.42;
      const verts = gem.verts.map((v) => {
        return rotate([v[0] * gs, v[1] * gs + bob, v[2] * gs], 0.32, -t * 0.7, 0.05);
      });
      const faces = gem.faces
        .map((f) => {
          const a = vertex(verts, f[0]);
          const b = vertex(verts, f[1]);
          const c = vertex(verts, f[2]);
          const e1: Vec = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
          const e2: Vec = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
          const n = normalise([e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]]);
          const z = f.reduce((sum, i) => sum + vertex(verts, i)[2], 0) / f.length;
          return { f, n, z };
        })
        .filter((face) => face.n[2] < 0)
        .sort((a, b) => b.z - a.z);
      for (const face of faces) {
        const light = Math.max(0, -dot(face.n, LIGHT));
        const sparkle = Math.pow(light, 6);
        const base = sky(0.75 + face.n[0] * 0.2 + t * 0.05);
        const k = 0.55 + 0.45 * light;
        const col = base.map((ch) => Math.round(ch + (255 - ch) * Math.min(1, k + sparkle * 0.6)));
        ctx.beginPath();
        face.f.forEach((i, idx) => {
          const [x, y] = project(vertex(verts, i));
          if (idx === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        ctx.closePath();
        ctx.fillStyle = `rgba(${col[0]},${col[1]},${col[2]},0.94)`;
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.85)';
        ctx.lineWidth = 0.8;
        ctx.stroke();
      }

      paint(front);

      // A few motes of light orbit just outside the ring.
      for (let i = 0; i < 5; i++) {
        const a = t * (0.6 + i * 0.07) + (i * Math.PI * 2) / 5;
        const p = rotate([Math.cos(a) * 1.28, Math.sin(a * 2) * 0.06, Math.sin(a) * 1.28], tilt, 0, wobble);
        const [x, y, f] = project(p);
        const tw = 0.5 + 0.5 * Math.sin(t * 3 + i);
        ctx.fillStyle = `rgba(186,230,253,${(0.35 + tw * 0.5).toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(x, y, (1.4 + tw * 1.6) * f * (scale / 150), 0, Math.PI * 2);
        ctx.fill();
      }
    };

    const loop = (time: number) => {
      draw(time);
      if (running) frame = requestAnimationFrame(loop);
    };

    const startLoop = () => {
      if (running || reduce || !visible || document.hidden) return;
      running = true;
      frame = requestAnimationFrame(loop);
    };
    const stopLoop = () => {
      running = false;
      cancelAnimationFrame(frame);
    };

    resize();
    draw(start + 1800);
    const ro = new ResizeObserver(() => {
      resize();
      if (!running) draw(performance.now());
    });
    ro.observe(canvas);
    const io = new IntersectionObserver(([entry]) => {
      visible = entry?.isIntersecting ?? true;
      if (visible) startLoop();
      else stopLoop();
    });
    io.observe(canvas);
    const onVisibility = () => {
      if (document.hidden) stopLoop();
      else startLoop();
    };
    document.addEventListener('visibilitychange', onVisibility);
    startLoop();

    return () => {
      stopLoop();
      ro.disconnect();
      io.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  return (
    <div className={className ? `halo ${className}` : 'halo'}>
      <div className="halo__glow" aria-hidden="true" />
      <canvas ref={canvasRef} className="halo__canvas" role="img" aria-label={label} />
    </div>
  );
}
