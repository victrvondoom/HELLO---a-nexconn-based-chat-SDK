import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : /\.(ts|tsx|mts|mjs)$/.test(name) ? [path] : [];
  });
}

describe('CON-FUZZ ground truth isolation', () => {
  it('is imported by no application code: search, Critic, proposer, services and routes never see it', () => {
    const offenders = files('src').filter((f) => /(from\s*['"][^'"]*groundtruth|import\(\s*['"][^'"]*groundtruth|require\(\s*['"][^'"]*groundtruth)/.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('lives only with the offline evaluator', () => {
    const users = files('tests').filter((f) => /from ['"][./]*groundtruth['"]|resilience\/groundtruth/.test(readFileSync(f, 'utf8')));
    for (const f of users) expect(f.startsWith(join('tests', 'resilience')) || f.startsWith(join('tests', 'unit', 'resilience'))).toBe(true);
  });
});
