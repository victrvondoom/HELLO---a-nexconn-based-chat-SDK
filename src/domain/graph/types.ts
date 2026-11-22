/**
 * The Context Memory Graph contract.
 *
 * The graph is a typed view over authoritative records (venue spaces, rooms, live reports, incidents, safety
 * holds, people). It is built on demand by `projectGraph` and is never stored or mutated on its own. The
 * authoritative records remain the only source of truth.
 *
 * Every node and edge carries provenance: which record it came from, when it was recorded, when it happened,
 * and how far it can be trusted. Inferred links are marked as inferred and are never presented as verified.
 */

export const NODE_KINDS = ['EVENT', 'ZONE', 'SPACE', 'LIVE_REPORT', 'INCIDENT', 'PERSON', 'SAFETY_HOLD'] as const;
export type NodeKind = (typeof NODE_KINDS)[number];

export const EDGE_KINDS = [
  'OCCURRED_IN',
  'IN_ZONE',
  'REPORTED_BY',
  'ATTACHED_TO',
  'CORROBORATES',
  'CONTRADICTS',
  'SCOPED_TO',
  'PLACED_BY',
] as const;
export type EdgeKind = (typeof EDGE_KINDS)[number];

/**
 * What kind of claim a graph fact is. VERIFIED: an operator or a server transition recorded it. REPORTED: a
 * person said it, and nothing has checked it. INFERRED: a deterministic rule linked it. Inferred links are
 * never promoted to verified.
 */
export type Verification = 'VERIFIED' | 'REPORTED' | 'INFERRED';

export interface Provenance {
  source: { collection: string; id: string };
  /** When the system recorded the underlying record (server time). */
  recordedAt: number;
  /** When the thing it describes happened, as far as the record says. */
  eventAt: number;
  verification: Verification;
  /** 1 for records; below 1 only for inferred links. */
  confidence: number;
}

export type AttrValue = string | number | boolean | null | string[];

export interface GraphNode {
  id: string;
  kind: NodeKind;
  label: string;
  attrs: Record<string, AttrValue>;
  provenance: Provenance;
}

export interface GraphEdge {
  from: string;
  to: string;
  kind: EdgeKind;
  provenance: Provenance;
}

/** Which node kinds each edge kind may connect. Anything else is an invariant violation. */
export const EDGE_RULES: Record<EdgeKind, { from: readonly NodeKind[]; to: readonly NodeKind[] }> = {
  OCCURRED_IN: { from: ['LIVE_REPORT'], to: ['SPACE'] },
  IN_ZONE: { from: ['SPACE'], to: ['ZONE'] },
  REPORTED_BY: { from: ['LIVE_REPORT'], to: ['PERSON'] },
  ATTACHED_TO: { from: ['LIVE_REPORT'], to: ['INCIDENT'] },
  CORROBORATES: { from: ['LIVE_REPORT'], to: ['LIVE_REPORT'] },
  CONTRADICTS: { from: ['LIVE_REPORT'], to: ['INCIDENT'] },
  SCOPED_TO: { from: ['SAFETY_HOLD'], to: ['EVENT', 'ZONE', 'LIVE_REPORT'] },
  PLACED_BY: { from: ['SAFETY_HOLD'], to: ['PERSON'] },
};

export interface ContextGraph {
  eventId: string;
  now: number;
  nodes: ReadonlyMap<string, GraphNode>;
  /** Both directions, so traversal can follow an edge from either end. */
  adjacency: ReadonlyMap<string, readonly GraphEdge[]>;
  /** The holds the graph was built from. Empty when `holdsAvailable` is false. */
  holds: ReadonlyArray<{
    id: string;
    scope: { kind: 'EVENT' } | { kind: 'ZONE'; zone: string } | { kind: 'REPORT'; reportId: string };
    status: 'IN_FORCE' | 'RELEASED';
    reason: string;
    placedByUserId: string;
    placedAt: number;
    decisionDueAt: number;
  }>;
  /** False when the safety-hold records could not be read. Snapshots then say so instead of assuming no holds. */
  holdsAvailable: boolean;
}

export const nodeId = {
  event: (id: string) => `event:${id}`,
  zone: (zone: string) => `zone:${zone}`,
  space: (id: string) => `space:${id}`,
  report: (id: string) => `report:${id}`,
  incident: (id: string) => `incident:${id}`,
  person: (id: string) => `person:${id}`,
  hold: (id: string) => `hold:${id}`,
};
