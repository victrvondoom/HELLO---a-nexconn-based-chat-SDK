# ADR 0001: The context graph is a derived projection over authoritative records

Status: accepted, 2026-11-22. Scope: LiveScene and LiveShield (first vertical slice).

## Context

HELLO needs one shared understanding of a live event: what was reported, where, what has been done about it,
what is suspended, and who may know what. The brief asked for a "context graph". A graph database, a vector store
or a second mutable copy of incidents would each create a source of truth that disagrees with the incident record.

## Decision

1. **The graph is computed, not stored.** `projectGraph` (`src/domain/graph/project.ts`) builds it from records the
   services already load: venue spaces, rooms, live reports, incidents, safety holds and people. Nothing is written
   back, so there is no second copy to drift.
2. **Edges are typed and checked.** `EDGE_RULES` (`src/domain/graph/types.ts`) says which node kinds each relation may
   join. `projectGraph` throws if a relation would break a rule, so a malformed link fails in tests, not in a snapshot.
3. **Every node and edge carries provenance**: source collection and id, recorded and event times, verification
   (`VERIFIED`, `REPORTED`, `INFERRED`) and confidence. Inferred links are never labelled verified.
4. **One compiler decides visibility.** `compileContext` (`src/domain/graph/compile.ts`) is the only route from the
   graph to a person. It uses `viewVerdict`, which the live feed also calls, so a list and a snapshot cannot disagree.
5. **Incidents stay authoritative.** A live report's resolution is read from its linked incident every time
   (`resolutionOf`). Nothing copies "resolved" onto the report.
6. **Holds fail closed.** If hold records cannot be read, attendees see only their own reports and staff are told
   that suspension status is unknown.
7. **Live reports are a new document collection**, not a new store. They use the existing typed collections, so both
   the memory and Postgres adapters support them with no migration.

## Consequences

- No new infrastructure. Cost is recomputation per request, bounded by the event's size and by the traversal limits
  (depth 2, 60 nodes, `truncated` reported). This is acceptable for one event; it is not designed for millions of nodes.
- The graph cannot answer questions the records cannot answer. Anything beyond that (embeddings, cross-event memory,
  model reasoning) needs its own decision record.
- Correlation (`CORROBORATES`, `CONTRADICTS`) is rule-based and marked inferred. It is a grouping for review, not a
  claim that two reports describe one problem.

## Alternatives rejected

- **A graph database (Neo4j or similar).** Adds infrastructure and a second source of truth, for a graph this size.
- **A vector store as "memory".** Retrieval by similarity cannot express provenance, expiry, permission or
  contradiction, which the brief requires.
- **A model as the memory.** Model output is a candidate, not a record. Nothing here lets a model write state.
