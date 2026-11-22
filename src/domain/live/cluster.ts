/**
 * Spatial and temporal correlation of live reports, with union-find.
 *
 * Two reports are correlated when they are close in time (within `windowMs`) AND either
 * - they describe the same venue space, or
 * - they are in the same zone and in the same category.
 *
 * Transitivity is intentional: a chain of reports, each within the window of the next, is one cluster.
 * This is a deterministic rule. It groups reports that may be about one problem; it never says they are
 * the same problem, and the result is recorded as inferred, not verified.
 *
 * Cost: reports are bucketed by space and by zone+category, then each bucket is sorted by time. Within a
 * sorted bucket, neighbours closer than the window are the only pairs that can be connected, so the work is
 * O(n log n), not the O(n²) of comparing every pair.
 */

export interface Correlatable {
  id: string;
  spaceId: string;
  zone: string;
  category: string;
  createdAt: number;
}

export function correlate<T extends Correlatable>(reports: readonly T[], windowMs: number): T[][] {
  const parent = new Map<string, string>();
  const byId = new Map<string, T>();
  for (const report of reports) {
    parent.set(report.id, report.id);
    byId.set(report.id, report);
  }

  const find = (id: string): string => {
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root) as string;
    // Path compression keeps later lookups near constant time.
    let cursor = id;
    while (cursor !== root) {
      const next = parent.get(cursor) as string;
      parent.set(cursor, root);
      cursor = next;
    }
    return root;
  };
  const union = (a: string, b: string): void => {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) parent.set(rootB, rootA);
  };

  const buckets = new Map<string, T[]>();
  const add = (key: string, report: T): void => {
    const bucket = buckets.get(key);
    if (bucket) bucket.push(report);
    else buckets.set(key, [report]);
  };
  for (const report of reports) {
    add(`space:${report.spaceId}`, report);
    add(`zone:${report.zone}|${report.category}`, report);
  }

  for (const members of buckets.values()) {
    members.sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    // Sorted, so a gap larger than the window separates two runs for good. Consecutive neighbours inside a
    // run are enough to connect the whole run.
    for (let i = 1; i < members.length; i += 1) {
      const previous = members[i - 1] as T;
      const current = members[i] as T;
      if (current.createdAt - previous.createdAt <= windowMs) union(previous.id, current.id);
    }
  }

  const groups = new Map<string, T[]>();
  for (const report of reports) {
    const root = find(report.id);
    const group = groups.get(root);
    if (group) group.push(byId.get(report.id) as T);
    else groups.set(root, [byId.get(report.id) as T]);
  }
  return [...groups.values()]
    .map((group) => group.sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)))
    .sort((a, b) => (a[0]?.createdAt ?? 0) - (b[0]?.createdAt ?? 0));
}
