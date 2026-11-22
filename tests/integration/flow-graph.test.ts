import { describe, expect, it } from 'vitest';
import { createHarness } from './harness';
import { flowSnapshot, WORKFLOWS } from '@/services/workflows';

/** Every node reachable from every other when edges are read in both directions. */
function components(nodes: Array<{ id: string }>, edges: Array<{ from: string; to: string }>): string[][] {
  const next = new Map(nodes.map((n) => [n.id, new Set<string>()] as const));
  for (const e of edges) {
    next.get(e.from)?.add(e.to);
    next.get(e.to)?.add(e.from);
  }
  const seen = new Set<string>();
  const out: string[][] = [];
  for (const n of nodes) {
    if (seen.has(n.id)) continue;
    const group: string[] = [];
    const stack = [n.id];
    while (stack.length) {
      const id = stack.pop() as string;
      if (seen.has(id)) continue;
      seen.add(id);
      group.push(id);
      for (const m of next.get(id) ?? []) stack.push(m);
    }
    out.push(group);
  }
  return out;
}

describe('workflow canvas', () => {
  it('is one connected graph for every role, with no dangling edges', async () => {
    const h = await createHarness();
    for (const userId of [h.users.attendeeAda, h.users.speakerInes, h.users.volunteerJamal, h.users.opsKiri, h.users.organiserNadia]) {
      const snap = await flowSnapshot(h.ctx, h.eventId, userId);
      const ids = new Set(snap.nodes.map((n) => n.id));
      for (const e of snap.edges) {
        expect(ids.has(e.from), `${userId}: edge from ${e.from}`).toBe(true);
        expect(ids.has(e.to), `${userId}: edge to ${e.to}`).toBe(true);
      }
      const groups = components(snap.nodes, snap.edges);
      expect(groups, `${userId}: ${JSON.stringify(groups)}`).toHaveLength(1);
    }
  });

  it('connects each workflow to what it reads and what it writes', async () => {
    const h = await createHarness();
    const snap = await flowSnapshot(h.ctx, h.eventId, h.users.organiserNadia);
    for (const w of WORKFLOWS) {
      const id = `wf:${w.id}`;
      if (!snap.nodes.some((n) => n.id === id)) continue;
      expect(snap.edges.filter((e) => e.to === id).map((e) => e.from).sort()).toEqual([...w.reads].sort());
      expect(snap.edges.filter((e) => e.from === id).map((e) => e.to).sort()).toEqual([...w.feeds].sort());
    }
  });
});
