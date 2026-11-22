import type { Incident, Room } from '../types';
import type { LiveReport, SafetyHold } from '../product';
import type { Space } from '../venue/types';
import { correlate } from '../live/cluster';
import { CLUSTER_WINDOW_MS, promotionCategoryFor } from '../live/rules';
import {
  EDGE_RULES,
  nodeId,
  type ContextGraph,
  type EdgeKind,
  type GraphEdge,
  type GraphNode,
  type Provenance,
} from './types';

/** Grouped by a rule, not confirmed to be the same problem. Carried on every inferred link. */
export const INFERRED_CONFIDENCE = 0.5;

export interface GraphInput {
  eventId: string;
  now: number;
  spaces: readonly Pick<Space, 'id' | 'name' | 'roomId'>[];
  rooms: readonly Pick<Room, 'id' | 'name' | 'zone'>[];
  reports: readonly LiveReport[];
  incidents: readonly Pick<Incident, 'id' | 'title' | 'status' | 'category' | 'roomId' | 'createdByUserId' | 'resolvedAt' | 'createdAt' | 'updatedAt'>[];
  incidentReporters: readonly { incidentId: string; reporterUserId: string }[];
  holds: readonly SafetyHold[];
  /** False when the hold records could not be read. No hold nodes are built in that case. */
  holdsAvailable: boolean;
  /** userId to display name. Names are used only inside staff-visible statements. */
  people: ReadonlyMap<string, string>;
}

const CONTRADICTABLE = new Set(['RESOLVED', 'CONFIRMED', 'CLOSED']);

/**
 * Builds the context graph from authoritative records. Pure and deterministic: the same input always gives the
 * same graph, and every edge is checked against EDGE_RULES, so a malformed relationship fails loudly here
 * instead of reaching a snapshot.
 */
export function projectGraph(input: GraphInput): ContextGraph {
  const nodes = new Map<string, GraphNode>();
  const adjacency = new Map<string, GraphEdge[]>();
  const now = input.now;

  const prov = (collection: string, id: string, recordedAt: number, eventAt: number, verification: Provenance['verification'], confidence = 1): Provenance => ({
    source: { collection, id },
    recordedAt,
    eventAt,
    verification,
    confidence,
  });

  const addNode = (node: GraphNode): void => {
    if (!nodes.has(node.id)) nodes.set(node.id, node);
  };

  const addEdge = (from: string, to: string, kind: EdgeKind, provenance: Provenance): void => {
    const source = nodes.get(from);
    const target = nodes.get(to);
    if (!source || !target) throw new Error(`context graph: ${kind} references a node that is not in the graph (${from} to ${to}).`);
    const rule = EDGE_RULES[kind];
    if (!rule.from.includes(source.kind) || !rule.to.includes(target.kind)) {
      throw new Error(`context graph: ${kind} cannot connect ${source.kind} to ${target.kind}.`);
    }
    const edge: GraphEdge = { from, to, kind, provenance };
    push(adjacency, from, edge);
    push(adjacency, to, edge);
  };

  const ensureZone = (zone: string): string => {
    const id = nodeId.zone(zone);
    addNode({ id, kind: 'ZONE', label: zone, attrs: {}, provenance: prov('rooms', zone, now, now, 'VERIFIED') });
    return id;
  };

  const ensurePerson = (userId: string): string => {
    const id = nodeId.person(userId);
    addNode({
      id,
      kind: 'PERSON',
      label: input.people.get(userId) ?? 'Unknown person',
      attrs: {},
      provenance: prov('users', userId, now, now, 'VERIFIED'),
    });
    return id;
  };

  const event = nodeId.event(input.eventId);
  addNode({ id: event, kind: 'EVENT', label: input.eventId, attrs: {}, provenance: prov('events', input.eventId, now, now, 'VERIFIED') });

  // --- venue: spaces, and the zone each space belongs to ---
  const roomById = new Map(input.rooms.map((room) => [room.id, room] as const));
  const spaceByRoom = new Map<string, string>();
  for (const space of [...input.spaces].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    const room = space.roomId ? roomById.get(space.roomId) : undefined;
    const zone = room?.zone ?? space.name;
    if (space.roomId) spaceByRoom.set(space.roomId, space.id);
    const zoneId = ensureZone(zone);
    const spaceId = nodeId.space(space.id);
    addNode({
      id: spaceId,
      kind: 'SPACE',
      label: space.name,
      attrs: { zone, roomId: space.roomId },
      provenance: prov('venue', space.id, now, now, 'VERIFIED'),
    });
    addEdge(spaceId, zoneId, 'IN_ZONE', prov('venue', space.id, now, now, 'VERIFIED'));
  }

  // --- live reports ---
  const reports = [...input.reports].sort((a, b) => (a.id < b.id ? -1 : 1));
  for (const report of reports) {
    addNode({
      id: nodeId.report(report.id),
      kind: 'LIVE_REPORT',
      label: `${report.category} at ${report.zone}`,
      attrs: {
        category: report.category,
        zone: report.zone,
        spaceId: report.spaceId,
        status: report.status,
        text: report.text,
        safetySignal: report.safetySignal,
        incidentId: report.incidentId,
        createdAt: report.createdAt,
        expiresAt: report.expiresAt,
        decidedAt: report.decidedAt,
        decisionReason: report.decisionReason,
        reporterUserId: report.reporterUserId,
      },
      provenance: prov('liveReports', report.id, report.createdAt, report.createdAt, 'REPORTED'),
    });
  }
  for (const report of reports) {
    const reportId = nodeId.report(report.id);
    const reportProvenance = prov('liveReports', report.id, report.createdAt, report.createdAt, 'REPORTED');
    const personId = ensurePerson(report.reporterUserId);
    addEdge(reportId, personId, 'REPORTED_BY', reportProvenance);
    if (nodes.has(nodeId.space(report.spaceId))) {
      addEdge(reportId, nodeId.space(report.spaceId), 'OCCURRED_IN', reportProvenance);
    }
  }

  // --- incidents: the authoritative record of what was done ---
  const reportersByIncident = new Map<string, Set<string>>();
  for (const link of input.incidentReporters) {
    const set = reportersByIncident.get(link.incidentId) ?? new Set<string>();
    set.add(link.reporterUserId);
    reportersByIncident.set(link.incidentId, set);
  }
  for (const incident of [...input.incidents].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    const reporters = new Set([incident.createdByUserId, ...(reportersByIncident.get(incident.id) ?? [])]);
    const spaceId = incident.roomId ? (spaceByRoom.get(incident.roomId) ?? null) : null;
    addNode({
      id: nodeId.incident(incident.id),
      kind: 'INCIDENT',
      label: incident.title,
      attrs: {
        status: incident.status,
        category: incident.category,
        roomId: incident.roomId,
        spaceId,
        resolvedAt: incident.resolvedAt,
        reporterIds: [...reporters].sort(),
      },
      provenance: prov('incidents', incident.id, incident.createdAt, incident.updatedAt, 'VERIFIED'),
    });
  }
  for (const report of reports) {
    if (report.incidentId && nodes.has(nodeId.incident(report.incidentId))) {
      addEdge(nodeId.report(report.id), nodeId.incident(report.incidentId), 'ATTACHED_TO', prov('liveReports', report.id, report.createdAt, report.createdAt, 'VERIFIED'));
    }
  }

  // --- correlation: grouped by a rule, recorded as inferred ---
  const correlatable = reports.filter((report) => report.status !== 'DISMISSED');
  for (const cluster of correlate(correlatable, CLUSTER_WINDOW_MS)) {
    for (let i = 1; i < cluster.length; i += 1) {
      const earlier = cluster[i - 1];
      const later = cluster[i];
      if (!earlier || !later) continue;
      addEdge(
        nodeId.report(later.id),
        nodeId.report(earlier.id),
        'CORROBORATES',
        prov('liveReports', later.id, later.createdAt, later.createdAt, 'INFERRED', INFERRED_CONFIDENCE),
      );
    }
  }

  // --- contradiction: a resolved problem with a newer report of the same kind in the same place ---
  for (const incident of input.incidents) {
    const spaceId = incident.roomId ? (spaceByRoom.get(incident.roomId) ?? null) : null;
    if (!spaceId || incident.resolvedAt === null || !CONTRADICTABLE.has(incident.status)) continue;
    for (const report of reports) {
      if (report.spaceId !== spaceId || report.incidentId === incident.id || report.status === 'DISMISSED') continue;
      if (promotionCategoryFor(report.category) !== incident.category || report.createdAt <= incident.resolvedAt) continue;
      addEdge(
        nodeId.report(report.id),
        nodeId.incident(incident.id),
        'CONTRADICTS',
        prov('liveReports', report.id, report.createdAt, report.createdAt, 'INFERRED', INFERRED_CONFIDENCE),
      );
    }
  }

  // --- safety holds ---
  if (input.holdsAvailable) {
    for (const hold of [...input.holds].sort((a, b) => (a.id < b.id ? -1 : 1))) {
      const holdId = nodeId.hold(hold.id);
      const holdProvenance = prov('safetyHolds', hold.id, hold.placedAt, hold.placedAt, 'VERIFIED');
      addNode({
        id: holdId,
        kind: 'SAFETY_HOLD',
        label: hold.scope.kind === 'EVENT' ? 'Event-wide hold' : hold.scope.kind === 'ZONE' ? `Zone hold: ${hold.scope.zone}` : 'Report hold',
        attrs: {
          scopeKind: hold.scope.kind,
          status: hold.status,
          reason: hold.reason,
          placedAt: hold.placedAt,
          decisionDueAt: hold.decisionDueAt,
        },
        provenance: holdProvenance,
      });
      if (hold.scope.kind === 'EVENT') {
        addEdge(holdId, event, 'SCOPED_TO', holdProvenance);
      } else if (hold.scope.kind === 'ZONE') {
        addEdge(holdId, ensureZone(hold.scope.zone), 'SCOPED_TO', holdProvenance);
      } else if (nodes.has(nodeId.report(hold.scope.reportId))) {
        addEdge(holdId, nodeId.report(hold.scope.reportId), 'SCOPED_TO', holdProvenance);
      }
      addEdge(holdId, ensurePerson(hold.placedByUserId), 'PLACED_BY', holdProvenance);
    }
  }

  return {
    eventId: input.eventId,
    now,
    nodes,
    adjacency,
    holds: input.holdsAvailable ? [...input.holds] : [],
    holdsAvailable: input.holdsAvailable,
  };
}

function push(map: Map<string, GraphEdge[]>, key: string, edge: GraphEdge): void {
  const list = map.get(key);
  if (list) list.push(edge);
  else map.set(key, [edge]);
}
