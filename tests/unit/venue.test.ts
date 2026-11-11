import { describe, expect, it } from 'vitest';
import { findRoute } from '@/domain/venue/route';
import { placesOf } from '@/domain/venue/types';
import { buildDemoVenue } from '@/store/venue-seed';

const venue = buildDemoVenue('evt');

describe('venue model', () => {
  it('is internally consistent: every edge, space and poi points at a real node', () => {
    const ids = new Set(venue.nodes.map((n) => n.id));
    for (const e of venue.edges) {
      expect(ids.has(e.from), e.from).toBe(true);
      expect(ids.has(e.to), e.to).toBe(true);
    }
    for (const s of venue.spaces) expect(ids.has(s.nodeId), s.id).toBe(true);
    for (const p of venue.pois) expect(ids.has(p.nodeId), p.id).toBe(true);
  });

  it('reaches every place from the main entrance', () => {
    for (const place of placesOf(venue)) {
      expect(findRoute(venue, 'n-main-entrance', place.nodeId, { stepFree: false }).ok, place.id).toBe(true);
    }
  });

  it('links each schedule room to a space', () => {
    expect(venue.spaces.filter((s) => s.roomId).map((s) => s.roomId).sort()).toEqual(['r-2', 'r-3', 'r-4', 'r-main']);
  });
});

describe('wayfinding', () => {
  it('takes the stairs when allowed and the lift when step-free', () => {
    const quick = findRoute(venue, 'n-main-entrance', 'n-quiet', { stepFree: false });
    const level = findRoute(venue, 'n-main-entrance', 'n-quiet', { stepFree: true });
    expect(quick.ok && quick.legs.some((l) => l.kind === 'STAIRS')).toBe(true);
    expect(level.ok && level.legs.some((l) => l.kind === 'LIFT')).toBe(true);
    expect(level.ok && level.legs.every((l) => l.kind !== 'STAIRS')).toBe(true);
    expect(level.ok && level.steps.join(' ')).toMatch(/Take the lift to the first floor/);
  });

  it('refuses, with the reason, when a place has no step-free route', () => {
    const r = findRoute(venue, 'n-east-entrance', 'n-r2', { stepFree: true });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/no step-free route/i);
    expect(findRoute(venue, 'n-east-entrance', 'n-r2', { stepFree: false }).ok).toBe(true);
  });

  it('describes the route and ends at the destination', () => {
    const r = findRoute(venue, 'n-east-entrance', 'n-r3', { stepFree: true });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.nodeIds[0]).toBe('n-east-entrance');
    expect(r.nodeIds.at(-1)).toBe('n-r3');
    expect(r.steps.at(-2)).toBe('Arrive at Room 3.');
    expect(r.metres).toBeGreaterThan(50);
    expect(r.seconds).toBeGreaterThan(r.metres / 1.2);
  });

  it('rejects unknown places', () => {
    expect(findRoute(venue, 'nope', 'n-r3', { stepFree: false }).ok).toBe(false);
  });
});
