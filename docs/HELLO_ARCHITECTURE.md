# HELLO architecture (2026-11-22)

```
                        Browser (Next.js client islands, PWA worker for /care only)
   Today · Explore · Live · People · Operations            Nexconn Chat SDK / Chat UI / Call SDK
            │  fetch /api/events/:id/**  +  SSE nudges              │ (token from POST /api/nexconn/token)
            ▼                                                       ▼
   ┌───────────────────────── Next.js server ─────────────────────────────────────────┐
   │ Routes (parse + rate limit) ──► Services (authority: requireCapability)           │
   │   live-room.ts  plan · AV signals · questions · seat holds · Plan B · care        │
   │   resilience.ts Steadfast check · approval gate · execution · targeted notify      │
   │   incidents.ts  (AV signals file reports through the same pipeline)               │
   │   workflows.ts, games.ts, people.ts, search.ts, … (existing)                      │
   │        │                         │                                                │
   │        ▼                         ▼                                                │
   │ Pure domain (no storage, no clock, no AI)                                         │
   │   domain/companion  av · questions · planb      domain/resilience  world ·        │
   │   domain/venue route (step-free routing)         simulator · search · repair ·    │
   │                                                  verify · event-world             │
   │        │                                                                          │
   │        ▼                                                                          │
   │ HelloStore contract ── Postgres (DATABASE_URL) │ Memory (+ disk, HELLO_DATA_DIR)  │
   │   typed document collections: plans, avSignals, liveQuestions, seatLedgers,       │
   │   scheduleProposals (+ all existing)                                               │
   │ Live layer: every write → content-free nudge (src/lib/live/store.ts policy)       │
   │ Chat gateway: signed webhook bridge for Nexconn (docs/nexconn-integration.md)     │
   └───────────────────────────────────────────────────────────────────────────────────┘
```

## Authority boundaries

- **Shared event context**: every module uses the event's own `Room`, `Session`, `Incident` ids. Steadfast builds
  its world from them (`worldFromEvent`) instead of copying; Plan B ranks the same sessions; AV signals file
  ordinary incidents.
- **Services decide**, React only presents. Every route goes through a service that calls `requireCapability`.
- **Concurrency**: one-shot transitions and capacity checks are conditional `docMutate` calls (row lock on
  Postgres, synchronous in memory): seat holds, proposal approval, AV-signal claiming.
- **AI**: none of the new modules calls a model. Steadfast, Plan B, question grouping and AV aggregation are
  deterministic. No model can approve, publish a schedule or award anything.
- **Nexconn** is the messaging transport. HELLO's backend stays authoritative for approvals, reservations,
  certificates and staff assignments; nothing received over chat can forge them.

## Data added in this pass

| Collection | Key | Owner / audience |
|---|---|---|
| `plans` | `eventId:userId` | The person only |
| `avSignals` | `sessionId:kind:userId` | The person; staff see counts |
| `liveQuestions` | generated | Text visible to the room; author hidden from other attendees |
| `seatLedgers` | session id | Holds keyed by person; counts shown |
| `scheduleProposals` | generated | Operations staff and organisers |

All are in the generic document table, so Postgres needs no migration. Export and erasure cover the personal
ones (`exportCompanion`, `eraseCompanion`).
