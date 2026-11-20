import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Each area stylesheet owns its top-level classes. Two files defining the same class silently fight over it,
 * and whichever loads later wins: that is how the Moments grid once replaced the Games tiles (`.tile`) and the
 * venue map legend (`.swatch`). Scoped rules (`.page .mesh`) and modifiers on another file's class are fine;
 * targeting a class that another area or the primitives already define is not.
 */

const STYLES = join(process.cwd(), 'src/styles');
const SHARED = new Set(['tokens.css', 'base.css', 'components.css']);

/** Every class that some selector targets directly, outside @-rule preludes and keyframe steps. */
function leadingClasses(css: string): Set<string> {
  const out = new Set<string>();
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const match of clean.matchAll(/([^{}]+)\{/g)) {
    const prelude = (match[1] ?? '').trim();
    if (prelude.startsWith('@')) continue;
    for (const selector of prelude.split(',')) {
      // Only a selector that targets the element itself (`.x`, `.x:hover`, `.x[aria-current]`, `.x::before`) defines
      // it. `.x > .y`, `.x .y` and `.x.y` style something else and may compose another file's class.
      const lead = /^\.([a-zA-Z][\w-]*)(?:::?[\w-]+(?:\([^)]*\))?|\[[^\]]*\])*$/.exec(selector.trim());
      if (lead?.[1]) out.add(lead[1]);
    }
  }
  return out;
}

const files = readdirSync(STYLES).filter((f) => f.endsWith('.css'));
const owners = new Map<string, Set<string>>(files.map((f) => [f, leadingClasses(readFileSync(join(STYLES, f), 'utf8'))]));

describe('stylesheet ownership', () => {
  it('finds the stylesheets it guards', () => {
    expect(files).toEqual(expect.arrayContaining(['components.css', 'shell.css', 'moments.css', 'social.css', 'venue.css', 'ops.css', 'landing.css']));
  });

  it('never lets two area stylesheets define the same top-level class', () => {
    const areas = files.filter((f) => !SHARED.has(f));
    const clashes: string[] = [];
    for (const [i, a] of areas.entries()) {
      for (const b of areas.slice(i + 1)) {
        for (const cls of owners.get(a) ?? []) if (owners.get(b)?.has(cls)) clashes.push(`.${cls} in ${a} and ${b}`);
      }
    }
    expect(clashes).toEqual([]);
  });

  it('never lets an area stylesheet redefine a shared primitive at top level', () => {
    const primitives = owners.get('components.css') ?? new Set<string>();
    const clashes: string[] = [];
    for (const f of files.filter((x) => !SHARED.has(x))) {
      for (const cls of owners.get(f) ?? []) if (primitives.has(cls)) clashes.push(`.${cls} in ${f}`);
    }
    expect(clashes).toEqual([]);
  });
});
