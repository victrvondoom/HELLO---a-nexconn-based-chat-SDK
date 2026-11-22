# Context graph and Context Snapshot: specification

This describes what is implemented as of 2026-11-22. Items marked **not built** are proposals.
Architecture decision: [adr/0001-context-graph.md](adr/0001-context-graph.md).

## 1. Entities (implemented)

| Node kind | Source record | Notes |
|---|---|---|
| EVENT | event | Scope root. |
| ZONE | rooms (`zone`), or a space without a room | The unit a safety hold covers. |
| SPACE | venue map | Carries its zone. |
| LIVE_REPORT | `liveReports` | Places, not positions. Expires by category. |
| INCIDENT | `incidents` | Authoritative for what was done. |
| PERSON | users | Names appear only in staff-visible statements. |
| SAFETY_HOLD | `safetyHolds` | Scope: whole event, zone, or one report. |

Not built: Organisation, Team, Route, Objective, Proposal, Vote, Evidence, Consent and Agent-run nodes. Each needs its
own product requirement before it exists.

## 2. Relations (implemented, with the rule each must satisfy)

| Edge | From to | Verification | Meaning |
|---|---|---|---|
| IN_ZONE | SPACE to ZONE | VERIFIED | Venue fact. |
| OCCURRED_IN | LIVE_REPORT to SPACE | REPORTED | The reporter chose the place. |
| REPORTED_BY | LIVE_REPORT to PERSON | REPORTED | Who sent it. Staff only, in statements. |
| ATTACHED_TO | LIVE_REPORT to INCIDENT | VERIFIED | Set by the promotion transition. |
| CORROBORATES | LIVE_REPORT to LIVE_REPORT | INFERRED, confidence 0.5 | Same place or zone and category, within 15 minutes. |
| CONTRADICTS | LIVE_REPORT to INCIDENT | INFERRED, confidence 0.5 | A resolved incident in the same place and category, with a newer report after resolution. |
| SCOPED_TO | SAFETY_HOLD to EVENT, ZONE or LIVE_REPORT | VERIFIED | The hold's scope. |
| PLACED_BY | SAFETY_HOLD to PERSON | VERIFIED | Who placed it. |

## 3. Provenance

Each node and edge has `source {collection, id}`, `recordedAt` (server time), `eventAt` (as far as the record says),
`verification` and `confidence`. A snapshot fact carries the provenance of every node it names.

## 4. Context Snapshot (schema version 1)

```
{ id, schemaVersion: 1, eventId, scope, viewer: 'STAFF' | 'ATTENDEE', generatedAt,
  facts:       [{ id, kind: VERIFIED|REPORTED|INFERRED|CONTRADICTED, statement, nodeIds, provenance[] }],
  missing:     [string],          // a gap, never filled with a guess
  expired:     [{ label, expiredAt }],
  prohibited:  [reason],          // reasons only, never the withheld item
  recommendations: [{ action, rationale, requiredCapability, basedOnFactIds[] }],
  traversal:   { maxDepth: 2, maxNodes: 60, visitedNodes, truncated } }
```

Scope is one report, or one zone. Traversal is breadth-first from the scope and stops at the depth and node limits.

## 5. Visibility (enforced by `viewVerdict`)

| Node | Staff | Attendee |
|---|---|---|
| Live report | Yes, with text and reporter | Own report: yes. Others: only while live and not held. Expired or dismissed: no. |
| Incident | Yes | Only if the attendee reported it. |
| Person | Yes | Only themselves. |
| Safety hold | Yes | No (the zone shows "under review" to its reporter only). |
| If hold records are unknown | Yes, with a `missing` entry | Only their own reports (`HOLD_STATUS_UNKNOWN`). |

## 6. State machines

**Live report:** `OPEN` → `PROMOTING` → `PROMOTED` (incident exists). `OPEN` → `DISMISSED` (reason required).
`PROMOTING` returns to `OPEN` if opening the incident fails. Expiry is a time check, not a state change: an expired
report leaves the live view and stays in the record.

**Resolution (derived, never stored on the report):** no incident → `REPORTED` or `BEING_HANDLED`. Incident `RESOLVED` →
`RESOLUTION_PENDING_CONFIRMATION`. Incident `CONFIRMED` or `CLOSED` → `VERIFIED_RESOLVED`. Incident `CANCELLED` → `CANCELLED`.

**Safety hold:** `IN_FORCE` → `RELEASED`. Nothing else. The decision due time only marks a hold *overdue*; it never
releases it. Release requires `safety.release` and a different person from the one who placed the hold, checked again
inside the compare-and-set.

## 7. Authority

| Action | Capability | Roles |
|---|---|---|
| Send a report | `incident.report` | All members |
| Review, promote, dismiss live reports | `live.review` | Operations staff, organisers |
| Place a zone or report hold | `safety.hold` | Operations staff, organisers |
| Place a whole-event hold | `safety.hold.event` | Organisers |
| Release a hold | `safety.release` | Organisers, not the placer |

## 8. Guarantees and their evidence

- Promotion is exactly-once per report: `tests/integration/live-scene.test.ts`, concurrent promotion case.
- Hold placement is idempotent per scope: the same test file.
- Visibility is the same for the feed and the snapshot: `tests/unit/live-cluster-graph.test.ts` and the integration cases.
- Expired reports leave the live view but stay in the record: integration test "drops a report from the live view".
- Unknown hold state fails closed: integration test "fails closed when the hold records cannot be read".
- Attendees never receive another person's name or report text: integration and unit no-leak cases.

## 9. Limits

- Location is zone-level: a report names a venue space. There are no coordinates, so there is no geometric clustering.
- Clustering is O(n log n) by sorted buckets and union-find (`src/domain/live/cluster.ts`), not a spatial index.
- Promotion and hold writes are not one database transaction. A crash between steps can leave a report `PROMOTING`;
  it is returned to `OPEN` on the next error path, but a hard crash needs manual review. Postgres transactions would fix it.
- The expiry of a live report is computed on read. Pages refresh on change events, not at the expiry moment.
- No model is in the loop. Recommendations are deterministic.
