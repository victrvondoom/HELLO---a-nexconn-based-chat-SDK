import type { Capability } from '../permissions';
import type { LiveReport } from '../product';
import { STATUS_LABEL } from '../labels';
import {
  holdCovers,
  holdOverdue,
  LIVE_CATEGORY_LABEL,
  minutesBetween,
  needsDecision,
  promotionCategoryFor,
  resolutionOf,
  type LiveCategory,
  type ResolutionState,
} from '../live/rules';
import type { IncidentStatus } from '../types';
import { nodeId, type ContextGraph, type GraphEdge, type GraphNode, type Provenance } from './types';

/**
 * The Context Compiler: the only route from the graph to a person.
 *
 * It takes a graph, a viewer and a scope, walks outward a bounded number of steps, and keeps only what that
 * viewer may see. Visibility is decided here, per node kind, so no caller can bypass it by asking for more.
 * The result is a Context Snapshot: facts with provenance, what is missing, what has expired, what was kept
 * back (by reason only, never by identity), and deterministic recommendations with the capability each needs.
 *
 * Facts keep their kind. Verified records, reported claims, inferred groupings and contradictions are never
 * merged into one statement.
 */

export type ContextScope = { kind: 'REPORT'; reportId: string } | { kind: 'ZONE'; zone: string };

export interface Viewer {
  userId: string;
  /** Operations staff and organisers. Attendees get the public view. */
  staff: boolean;
}

export type FactKind = 'VERIFIED' | 'REPORTED' | 'INFERRED' | 'CONTRADICTED';

export interface ContextFact {
  id: string;
  kind: FactKind;
  statement: string;
  nodeIds: string[];
  provenance: Provenance[];
}

export interface ExpiredItem {
  label: string;
  expiredAt: number;
}

/** Why something was kept back. The reason is reported; the thing itself is not. */
export type ProhibitionReason = 'NOT_PERMITTED_FOR_VIEWER' | 'SUSPENDED_BY_SAFETY_HOLD' | 'NOT_PUBLIC' | 'IDENTITY_NOT_SHARED' | 'HOLD_STATUS_UNKNOWN';

export interface Recommendation {
  action: 'REVIEW_NOW' | 'PROMOTE_TO_INCIDENT' | 'CONSIDER_ZONE_HOLD' | 'AWAIT_REPORTER_CONFIRMATION';
  rationale: string;
  /** The capability the action needs. Null when the reporter, not staff, must act. */
  requiredCapability: Capability | null;
  basedOnFactIds: string[];
}

export interface ContextSnapshot {
  id: string;
  schemaVersion: 1;
  eventId: string;
  scope: ContextScope;
  viewer: 'STAFF' | 'ATTENDEE';
  generatedAt: number;
  facts: ContextFact[];
  missing: string[];
  expired: ExpiredItem[];
  prohibited: ProhibitionReason[];
  recommendations: Recommendation[];
  traversal: { maxDepth: number; maxNodes: number; visitedNodes: number; truncated: boolean };
}

export interface CompileOptions {
  id: string;
  now: number;
  viewer: Viewer;
  scope: ContextScope;
  maxDepth?: number;
  maxNodes?: number;
}

export type Verdict = { kind: 'VISIBLE' } | { kind: 'EXPIRED' } | { kind: 'BLOCKED'; reason: ProhibitionReason };

/**
 * What one viewer may see of one node at `now`. The Context Compiler and the live feed both call this, so they
 * cannot disagree about who sees what. Fails closed: when hold records are unreadable, attendees see no live
 * report other than their own.
 */
export function viewVerdict(graph: ContextGraph, node: GraphNode, viewer: Viewer, now: number): Verdict {
  const attrs = node.attrs;
  const staff = viewer.staff;
  switch (node.kind) {
    case 'EVENT':
    case 'ZONE':
    case 'SPACE':
      return { kind: 'VISIBLE' };
    case 'PERSON':
      return staff || node.id === nodeId.person(viewer.userId) ? { kind: 'VISIBLE' } : { kind: 'BLOCKED', reason: 'IDENTITY_NOT_SHARED' };
    case 'SAFETY_HOLD':
      return staff ? { kind: 'VISIBLE' } : { kind: 'BLOCKED', reason: 'NOT_PERMITTED_FOR_VIEWER' };
    case 'INCIDENT': {
      const reporters = Array.isArray(attrs.reporterIds) ? attrs.reporterIds : [];
      return staff || reporters.includes(viewer.userId) ? { kind: 'VISIBLE' } : { kind: 'BLOCKED', reason: 'NOT_PERMITTED_FOR_VIEWER' };
    }
    case 'LIVE_REPORT': {
      const own = attrs.reporterUserId === viewer.userId;
      const expiresAt = numberAttr(node, 'expiresAt');
      if (now >= expiresAt) {
        // Expired reports leave the live view. Staff and the reporter keep sight of them as history.
        return staff || own ? { kind: 'EXPIRED' } : { kind: 'BLOCKED', reason: 'NOT_PUBLIC' };
      }
      if (statusOf(node) === 'DISMISSED') {
        return staff || own ? { kind: 'VISIBLE' } : { kind: 'BLOCKED', reason: 'NOT_PUBLIC' };
      }
      if (staff || own) return { kind: 'VISIBLE' };
      if (!graph.holdsAvailable) return { kind: 'BLOCKED', reason: 'HOLD_STATUS_UNKNOWN' };
      const held = graph.holds.some((hold) => holdCovers(hold, { id: reportIdOf(node), zone: String(attrs.zone) }));
      return held ? { kind: 'BLOCKED', reason: 'SUSPENDED_BY_SAFETY_HOLD' } : { kind: 'VISIBLE' };
    }
  }
}

const DEFAULT_MAX_DEPTH = 2;
const DEFAULT_MAX_NODES = 60;

export function compileContext(graph: ContextGraph, options: CompileOptions): ContextSnapshot {
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
  const maxNodes = options.maxNodes ?? DEFAULT_MAX_NODES;
  const { viewer, now } = options;
  const staff = viewer.staff;

  const missing: string[] = [];
  const expired: ExpiredItem[] = [];
  const prohibited = new Set<ProhibitionReason>();
  const visible = new Set<string>();
  let truncated = false;

  const start = options.scope.kind === 'REPORT' ? nodeId.report(options.scope.reportId) : nodeId.zone(options.scope.zone);

  const verdictFor = (node: GraphNode): Verdict => viewVerdict(graph, node, viewer, now);

  if (!graph.nodes.has(start)) {
    missing.push(options.scope.kind === 'REPORT' ? 'That report is not on the venue map or does not belong to this event.' : 'That zone is not on the venue map.');
  } else {
    const queue: Array<{ id: string; depth: number }> = [{ id: start, depth: 0 }];
    const seen = new Set<string>([start]);
    for (let head = 0; head < queue.length; head += 1) {
      const current = queue[head];
      if (!current) break;
      const node = graph.nodes.get(current.id);
      if (!node) continue;
      const verdict = verdictFor(node);
      if (verdict.kind === 'EXPIRED') {
        expired.push({ label: labelOf(node), expiredAt: numberAttr(node, 'expiresAt') });
        continue;
      }
      if (verdict.kind === 'BLOCKED') {
        prohibited.add(verdict.reason);
        continue;
      }
      if (visible.size >= maxNodes) {
        truncated = true;
        break;
      }
      visible.add(node.id);
      if (current.depth >= maxDepth) continue;
      for (const edge of graph.adjacency.get(node.id) ?? []) {
        const other = edge.from === node.id ? edge.to : edge.from;
        if (seen.has(other)) continue;
        seen.add(other);
        queue.push({ id: other, depth: current.depth + 1 });
      }
    }
  }

  const ordered = [...visible].sort();
  const facts: ContextFact[] = [];
  const factIdsByNode = new Map<string, string[]>();
  const addFact = (kind: FactKind, statement: string, nodeIds: string[], provenance: Provenance[]): string => {
    const id = `fact-${facts.length + 1}`;
    facts.push({ id, kind, statement, nodeIds, provenance });
    for (const nodeIdValue of nodeIds) {
      const list = factIdsByNode.get(nodeIdValue) ?? [];
      list.push(id);
      factIdsByNode.set(nodeIdValue, list);
    }
    return id;
  };

  const incidentOfReport = (reportNodeId: string): GraphNode | null => {
    for (const edge of graph.adjacency.get(reportNodeId) ?? []) {
      if (edge.kind !== 'ATTACHED_TO') continue;
      const target = graph.nodes.get(edge.to);
      if (target && target.kind === 'INCIDENT') return target;
    }
    return null;
  };

  for (const id of ordered) {
    const node = graph.nodes.get(id);
    if (!node) continue;
    if (node.kind === 'LIVE_REPORT') {
      const own = node.attrs.reporterUserId === viewer.userId;
      const incident = incidentOfReport(id);
      const resolution: ResolutionState = resolutionOf(
        { status: statusOf(node) },
        incident ? { status: incident.attrs.status as IncidentStatus } : null,
      );
      const category = node.attrs.category as LiveCategory;
      const categoryLabel = LIVE_CATEGORY_LABEL[category];
      const zone = String(node.attrs.zone);
      const minutes = minutesBetween(now, numberAttr(node, 'createdAt'));
      const provenance: Provenance[] = [node.provenance];
      let statement: string;
      if (staff) {
        const space = spaceName(graph, node);
        const reporter = reporterName(graph, node);
        statement = `${categoryLabel} report at ${zone}${space ? ` (${space})` : ''}, ${minutes} min ago, from ${reporter}: "${String(node.attrs.text)}". ${resolutionText(resolution)}.`;
      } else if (own) {
        statement = `Your ${categoryLabel.toLowerCase()} report about ${zone} is live. ${resolutionText(resolution)}.`;
      } else {
        statement = `${categoryLabel} report at ${zone}, ${minutes} min ago. ${resolutionText(resolution)}.`;
      }
      const nodeIds = [id];
      if (incident && visible.has(incident.id)) {
        nodeIds.push(incident.id);
        provenance.push(incident.provenance);
      }
      addFact('REPORTED', statement, nodeIds, provenance);
    } else if (node.kind === 'INCIDENT') {
      addFact(
        'VERIFIED',
        `Incident "${node.label}" is ${STATUS_LABEL[node.attrs.status as keyof typeof STATUS_LABEL]}.`,
        [id],
        [node.provenance],
      );
    } else if (node.kind === 'SAFETY_HOLD' && staff) {
      const hold = graph.holds.find((h) => nodeId.hold(h.id) === id);
      if (hold) {
        const due = new Date(hold.decisionDueAt).toISOString();
        const placer = graph.nodes.get(nodeId.person(hold.placedByUserId))?.label ?? 'a staff member';
        const text =
          hold.status === 'RELEASED'
            ? `${node.label} was released.`
            : holdOverdue(hold, now)
              ? `${node.label} is in force and its decision was due at ${due}. It stays in force until a different organiser releases it.`
              : `${node.label} is in force until a decision is due at ${due}.`;
        addFact('VERIFIED', `${text} Placed by ${placer}: "${hold.reason}".`, [id], [node.provenance]);
      }
    }
  }

  // Correlation and contradiction are facts about pairs of reports, added only between nodes the viewer may see.
  for (const id of ordered) {
    const node = graph.nodes.get(id);
    if (!node || node.kind !== 'LIVE_REPORT') continue;
    const corroborating = relatedVisible(graph, visible, id, 'CORROBORATES');
    if (corroborating.length > 0) {
      addFact(
        'INFERRED',
        `Grouped by rule with ${corroborating.length} other report${corroborating.length === 1 ? '' : 's'} in the same place or zone and category, within 15 minutes. This is an inferred grouping, not confirmation that they are one problem.`,
        [id, ...corroborating.map((edge) => (edge.from === id ? edge.to : edge.from))],
        corroborating.map((edge) => edge.provenance),
      );
    }
    if (staff) {
      const contradicting = (graph.adjacency.get(id) ?? []).filter((edge) => edge.kind === 'CONTRADICTS' && visible.has(edge.to));
      for (const edge of contradicting) {
        const incident = graph.nodes.get(edge.to);
        if (!incident) continue;
        addFact(
          'CONTRADICTED',
          `The ${String(node.attrs.category).toLowerCase()} incident "${incident.label}" was resolved, but a newer report from the same place arrived after that resolution. The two records disagree.`,
          [id, incident.id],
          [node.provenance, incident.provenance],
        );
      }
    }
  }

  // Missing information is reported as a gap, never filled with a guess.
  if (staff) {
    for (const id of ordered) {
      const node = graph.nodes.get(id);
      if (!node || node.kind !== 'LIVE_REPORT') continue;
      const category = node.attrs.category as LiveCategory;
      if (!incidentOfReport(id) && statusOf(node) === 'OPEN' && promotionCategoryFor(category) !== null) {
        missing.push(`No incident has been opened for the ${LIVE_CATEGORY_LABEL[category].toLowerCase()} report at ${String(node.attrs.zone)}.`);
      }
      if (needsDecision(decisionView(node))) {
        missing.push(`The ${LIVE_CATEGORY_LABEL[category].toLowerCase()} report at ${String(node.attrs.zone)} was flagged by the safety check and has no moderator decision yet.`);
      }
    }
    if (!graph.holdsAvailable) missing.push('Safety holds could not be read, so whether any suspension is in force is unknown.');
  }

  const recommendations: Recommendation[] = [];
  if (staff) {
    for (const id of ordered) {
      const node = graph.nodes.get(id);
      if (!node) continue;
      if (node.kind === 'INCIDENT' && node.attrs.status === 'RESOLVED') {
        recommendations.push({
          action: 'AWAIT_REPORTER_CONFIRMATION',
          rationale: 'The incident is marked resolved. It closes only after the reporter confirms, or it reopens.',
          requiredCapability: null,
          basedOnFactIds: factIdsByNode.get(id) ?? [],
        });
      }
      if (node.kind !== 'LIVE_REPORT') continue;
      const category = node.attrs.category as LiveCategory;
      const basis = factIdsByNode.get(id) ?? [];
      if (needsDecision(decisionView(node))) {
        recommendations.push({
          action: 'REVIEW_NOW',
          rationale: 'A safety-flagged report has no moderator decision. Review it, then promote it to an incident or dismiss it with a reason.',
          requiredCapability: 'live.review',
          basedOnFactIds: basis,
        });
        const related = relatedVisible(graph, visible, id, 'CORROBORATES').length + 1;
        const coveredByHold = graph.holds.some((hold) => holdCovers(hold, { id: reportIdOf(node), zone: String(node.attrs.zone) }));
        if (!coveredByHold && related >= 3) {
          recommendations.push({
            action: 'CONSIDER_ZONE_HOLD',
            rationale: `${related} related reports are unresolved in this zone. A zone hold suspends the public live view there until a different organiser releases it. It does not touch private messages.`,
            requiredCapability: 'safety.hold',
            basedOnFactIds: basis,
          });
        }
      }
      if (statusOf(node) === 'OPEN' && promotionCategoryFor(category) !== null && !incidentOfReport(id)) {
        recommendations.push({
          action: 'PROMOTE_TO_INCIDENT',
          rationale: 'This report describes a problem that needs an owner. Promoting it opens an incident with the reporter attached.',
          requiredCapability: 'live.review',
          basedOnFactIds: basis,
        });
      }
    }
  }

  return {
    id: options.id,
    schemaVersion: 1,
    eventId: graph.eventId,
    scope: options.scope,
    viewer: staff ? 'STAFF' : 'ATTENDEE',
    generatedAt: now,
    facts,
    missing,
    expired: expired.sort((a, b) => a.expiredAt - b.expiredAt || (a.label < b.label ? -1 : a.label > b.label ? 1 : 0)),
    prohibited: [...prohibited].sort(),
    recommendations,
    traversal: { maxDepth, maxNodes, visitedNodes: visible.size, truncated },
  };
}

function relatedVisible(graph: ContextGraph, visible: ReadonlySet<string>, id: string, kind: GraphEdge['kind']): GraphEdge[] {
  return (graph.adjacency.get(id) ?? []).filter((edge) => edge.kind === kind && visible.has(edge.from === id ? edge.to : edge.from));
}

function decisionView(node: GraphNode): Pick<LiveReport, 'safetySignal' | 'decidedAt' | 'status'> {
  return {
    safetySignal: nullableAttr(node, 'safetySignal') as LiveReport['safetySignal'],
    decidedAt: nullableNumber(node, 'decidedAt'),
    status: statusOf(node),
  };
}

function statusOf(node: GraphNode): LiveReport['status'] {
  return node.attrs.status as LiveReport['status'];
}

function reportIdOf(node: GraphNode): string {
  return node.id.startsWith('report:') ? node.id.slice('report:'.length) : node.id;
}

function labelOf(node: GraphNode): string {
  if (node.kind === 'LIVE_REPORT') return `${LIVE_CATEGORY_LABEL[node.attrs.category as LiveCategory]} report at ${String(node.attrs.zone)}`;
  return node.label;
}

function numberAttr(node: GraphNode, key: string): number {
  const value = node.attrs[key];
  return typeof value === 'number' ? value : 0;
}

function nullableNumber(node: GraphNode, key: string): number | null {
  const value = node.attrs[key];
  return typeof value === 'number' ? value : null;
}

function nullableAttr(node: GraphNode, key: string): string | null {
  const value = node.attrs[key];
  return typeof value === 'string' ? value : null;
}

function spaceName(graph: ContextGraph, node: GraphNode): string | null {
  const space = graph.nodes.get(nodeId.space(String(node.attrs.spaceId)));
  return space ? space.label : null;
}

function reporterName(graph: ContextGraph, node: GraphNode): string {
  const person = graph.nodes.get(nodeId.person(String(node.attrs.reporterUserId)));
  return person ? person.label : 'a person';
}

function resolutionText(state: ResolutionState): string {
  switch (state) {
    case 'REPORTED':
      return 'Not yet taken on by the team';
    case 'BEING_HANDLED':
      return 'Being handled by the team';
    case 'RESOLUTION_PENDING_CONFIRMATION':
      return 'Marked resolved; waiting for the reporter to confirm';
    case 'VERIFIED_RESOLVED':
      return 'Resolved and confirmed by the reporter';
    case 'CANCELLED':
      return 'Cancelled';
    case 'DISMISSED':
      return 'Dismissed after review';
  }
}
