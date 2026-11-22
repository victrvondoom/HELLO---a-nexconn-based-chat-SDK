import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, normalize, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * A Web Worker whose imports lead back to the module that spawns it (`new Worker(new URL('./x-worker.ts',
 * import.meta.url))`) makes Turbopack's production build recurse into the worker chunk and never finish: `next build`
 * stalls at "Creating an optimized production build" with no error. Three inherited Chatdom workers did this; their
 * pure code now lives in `*-core.ts` modules. This test keeps any worker from importing its spawner again.
 */

const ROOT = process.cwd();
const tsconfig = JSON.parse(readFileSync(join(ROOT, 'tsconfig.json'), 'utf8')) as { compilerOptions: { paths: Record<string, string[]> } };
const PATHS = tsconfig.compilerOptions.paths;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (name === 'node_modules' || name.startsWith('.')) return [];
    return statSync(full).isDirectory() ? files(full) : /\.(ts|tsx)$/.test(name) ? [full] : [];
  });
}

function resolve(spec: string, from: string): string | null {
  let base: string | null = null;
  const bare = spec.split('?')[0] ?? spec;
  if (bare.startsWith('.')) base = normalize(join(dirname(from), bare));
  else if (PATHS[bare]?.[0]) base = join(ROOT, PATHS[bare][0]);
  else if (bare.startsWith('@/')) base = join(ROOT, 'src', bare.slice(2));
  if (!base) return null;
  for (const ext of ['', '.ts', '.tsx', '/index.ts', '/index.tsx']) {
    const candidate = base + ext;
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

const IMPORT = /(?:import|export)[^'"]*?from\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g;
const WORKER = /new Worker\(\s*new URL\(\s*['"]([^'"]+)['"]\s*,\s*import\.meta\.url\s*\)/g;

const sources = files(join(ROOT, 'src'));
const imports = new Map<string, string[]>();
function importsOf(file: string): string[] {
  const known = imports.get(file);
  if (known) return known;
  const text = readFileSync(file, 'utf8');
  const out: string[] = [];
  for (const match of text.matchAll(IMPORT)) {
    const target = resolve(match[1] ?? match[2] ?? '', file);
    if (target && /\.(ts|tsx)$/.test(target)) out.push(target);
  }
  imports.set(file, out);
  return out;
}

function reaches(start: string, goal: string): boolean {
  const seen = new Set<string>();
  const stack = [start];
  while (stack.length > 0) {
    const file = stack.pop() as string;
    if (file === goal) return true;
    if (seen.has(file)) continue;
    seen.add(file);
    stack.push(...importsOf(file));
  }
  return false;
}

describe('Web Worker import cycles', () => {
  const spawns: Array<{ spawner: string; worker: string }> = [];
  for (const file of sources) {
    for (const match of readFileSync(file, 'utf8').matchAll(WORKER)) {
      const worker = resolve(match[1] ?? '', file);
      if (worker) spawns.push({ spawner: file, worker });
    }
  }

  it('finds the workers it guards', () => {
    expect(spawns.length).toBeGreaterThan(0);
  });

  it('never lets a worker import the module that spawns it', () => {
    const cycles = spawns.filter(({ spawner, worker }) => reaches(worker, spawner)).map(({ spawner, worker }) => `${relative(ROOT, worker)} imports ${relative(ROOT, spawner)}`);
    expect(cycles).toEqual([]);
  });
});
