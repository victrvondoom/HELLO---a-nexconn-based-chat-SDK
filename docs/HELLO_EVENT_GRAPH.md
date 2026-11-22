# Event graph (2026-11-22)

## What exists

- **Context graph** (`src/domain/graph`, `docs/context-graph.md`): an in-process projection of the event
  (zones, spaces, live reports, incidents, people, safety holds) with typed, provenance-carrying relations,
  used for Context Snapshots.
- **Shared identifiers**: every new module uses the event's own ids, which is the precondition for a graph.

## Not built (planned), and why

The brief asks for a graph database (FalkorDB or Neo4j) behind an idempotent transactional outbox, with
multi-hop Cypher queries, community detection and personalised PageRank, and a strict split between the
**shared event graph** and each person's **private relationship graph**. None of that is built in this pass:
no graph database is available in this environment, and a graph that only re-reads a flat list would be the
fake the brief forbids.

Design to follow when it is built:

1. Postgres stays the source of truth. A `graph_outbox` table is written in the same transaction as each
   change; a worker projects it idempotently (node/edge ids derived from source ids) and records sync status.
2. Node and edge types as listed in the brief, every edge with provenance: source record, who supplied it,
   when, visibility (public/shared/private), confirmed or inferred.
3. Private relationship data lives in a per-owner subgraph; every query is parameterised and starts from the
   viewer, with a depth bound, and never crosses another owner's private subgraph.
4. An algorithm registry (purpose, inputs, complexity, privacy boundary, fixtures, benchmark, version,
   fallback) for ranking, path discovery, clustering and temporal scoring.
5. Results that come from a stale projection are labelled with their sync time and never presented as current.
