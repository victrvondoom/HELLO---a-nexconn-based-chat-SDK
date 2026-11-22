/* eslint-disable @typescript-eslint/no-non-null-assertion -- tests assert the shape first and then read through it */
import { describe, expect, it } from 'vitest';
import { forgeFrom } from '@/domain/kingdom/forge';
import { actFor, CARAVAN_MAX, screenText } from '@/domain/kingdom/rules';
import { canStep, gatePosition, homeFor, inBounds, isWalkable, MAX_CITIZENS, MAX_STEP, nextFreeLot, streetPlan, tileAt, WORLD_SIZE } from '@/domain/kingdom/world';

const SEEDS = [1, 42, 2166136261, 4294967295, 123456789];

describe('kingdom world', () => {
  it('is a pure function of the seed', () => {
    for (const seed of SEEDS) {
      expect(tileAt(seed, 10, 12)).toEqual(tileAt(seed, 10, 12));
      expect(streetPlan(seed)).toEqual(streetPlan(seed));
    }
    expect(streetPlan(1)).not.toEqual(streetPlan(42));
  });

  it('always has dry ground at the gate and a street plan of unique, walkable, grass lots', () => {
    for (const seed of SEEDS) {
      const gate = gatePosition();
      expect(isWalkable(seed, gate.x, gate.z)).toBe(true);
      const plan = streetPlan(seed);
      expect(plan.length).toBeGreaterThan(20);
      expect(plan.length).toBeLessThanOrEqual(MAX_CITIZENS);
      expect(new Set(plan.map((l) => `${l.x},${l.z}`)).size).toBe(plan.length);
      plan.forEach((lot, i) => {
        expect(lot.index).toBe(i);
        expect(tileAt(seed, lot.x, lot.z).terrain).toBe('GRASS');
      });
    }
  });

  it('derives a home from its lot, and nothing for a lot that does not exist', () => {
    const home = homeFor(7, 0);
    expect(home).toMatchObject({ lot: 0 });
    expect(homeFor(7, 0)).toEqual(home);
    expect(homeFor(7, 9999)).toBeNull();
    expect(homeFor(7, -1)).toBeNull();
  });

  it('hands out the lowest free lot, and null when none is left', () => {
    expect(nextFreeLot(7, new Set())).toBe(0);
    expect(nextFreeLot(7, new Set([0, 1, 3]))).toBe(2);
    expect(nextFreeLot(7, new Set(streetPlan(7).map((l) => l.index)))).toBeNull();
  });

  it('refuses walks into water, off the map, non-integers and too far', () => {
    const seed = 42;
    const gate = gatePosition();
    expect(inBounds(-1, 0)).toBe(false);
    expect(inBounds(WORLD_SIZE, 0)).toBe(false);
    expect(inBounds(1.5, 2)).toBe(false);
    expect(canStep(seed, gate, { x: gate.x, z: gate.z })).toBe(true);
    expect(canStep(seed, gate, { x: gate.x + MAX_STEP + 1, z: gate.z })).toBe(false);
    expect(canStep(seed, gate, { x: 0, z: 0 })).toBe(false);
    const water = Array.from({ length: WORLD_SIZE }, (_, x) => ({ x, z: 0 })).find((p) => tileAt(seed, p.x, p.z).terrain === 'WATER');
    expect(water).toBeDefined();
    expect(isWalkable(seed, water!.x, water!.z)).toBe(false);
  });
});

describe('kingdom text screening', () => {
  it('accepts plain text and normalises whitespace', () => {
    expect(screenText('  The   Sunny  Realm ', 40, 'Name')).toEqual({ ok: true, text: 'The Sunny Realm' });
  });

  it('refuses empty, over-long, links, handles, hidden direction marks and listed words, with a reason', () => {
    for (const bad of ['', '   ', 'x'.repeat(41), 'visit https://evil.example', 'www.evil.example', 'follow @someone', 'hello‮world', 'a NAZI banner']) {
      const result = screenText(bad, 40, 'Name');
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toMatch(/Name/);
    }
  });
});

describe('the forge', () => {
  it('matches kits in four languages and picks up colours', () => {
    expect(forgeFrom('a red lantern')).toEqual({ kit: 'LANTERN', colour: '#dc2626' });
    expect(forgeFrom('ein blauer Brunnen blau')?.kit).toBe('FOUNTAIN');
    expect(forgeFrom('un árbol verde')).toEqual({ kit: 'TREE', colour: '#16a34a' });
    expect(forgeFrom('une tour')?.kit).toBe('TOWER');
    expect(forgeFrom('a bench')?.colour).toBe('#a3a3a3');
  });

  it('refuses a wish that names nothing it knows, so it can only ever make a listed kit', () => {
    expect(forgeFrom('a dragon that eats everyone')).toBeNull();
    expect(forgeFrom('')).toBeNull();
  });
});

describe('outside events become world acts', () => {
  it('turns a raid into a caravan, capped at the maximum', () => {
    expect(actFor('RAID', 'Mira', 12)).toEqual({ kind: 'CARAVAN', text: 'A caravan of 12 travellers from Mira arrived at the gate.' });
    expect(actFor('RAID', 'Mira', 5000).text).toContain(`${CARAVAN_MAX} (of 5000)`);
  });

  it('treats a missing or nonsense amount as one, and never trusts the source to name the act', () => {
    expect(actFor('CHEER', 'Sol', 0).text).toContain('1 cheer,');
    expect(actFor('CHEER', 'Sol', Number.NaN).text).toContain('1 cheer,');
    expect(actFor('FOLLOW', 'Sol', 1).kind).toBe('CHEER');
  });
});
