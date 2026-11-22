# Implementation roadmap (merged, 2026-11-22)

| Stage | Scope | State |
|---|---|---|
| 0 | Audit, shared contracts | Done: new modules reuse `Event`/`Room`/`Session`/`Incident`; Zod at every route |
| 1 | Five-destination navigation, unified context | Done: Today, Explore, Live, People, Operations; minimal sign-in; Kingdom door |
| 2 | Live session slice | Done except media: room QR → questions → AV signal → one incident. Captions/audio/slides blocked on a provider |
| 3 | Schedule intelligence (Grace Period) | Partial: approved changes reconcile plans and notify. Official-feed reconciler planned |
| 4 | Capy Plan B | Done: filters, score, step-free routes, atomic holds, room-full QR |
| 5 | Personal learning | Planned (needs captions) |
| 6–8 | Kairos graph, relationship memory, speed networking | Planned (needs a graph store) |
| 9 | CON-FUZZ | Done: simulator, search, benchmark, Critic, exact verifier, approval, execution |
| 10 | Integration and hardening | In progress: tests A–H below |

## Cross-module tests

| Test | State |
|---|---|
| A Networking and schedule | Planned (needs Kairos) |
| B Kairos and speed networking | Planned |
| C Live captions and room operations | AV part done (`live-room.test.ts`); captions blocked |
| D Live understanding | Planned |
| E Schedule failure and exact verification | Done (`resilience.test.ts`, `resilience.test.ts` unit) |
| F Capacity and Plan B | Done (`live-room.test.ts`) |
| G Offline care | Care content done; offline worker verified manually in a production build |
| H Security isolation | Partial: stale certificate, ground-truth isolation, staff-only boards, App Secret scan. Sponsor and graph cases wait for those features |

## Next, in dependency order

1. Media provider for captions/audio (choose provider; consent flow) → jargon coach → recap.
2. Grace Period feed reconciler (versioned snapshots, diff, Plan B on conflict).
3. Postgres transaction spanning a multi-session approved change.
4. Graph store + outbox → Kairos ranking → relationship memory → speed networking.
5. Nexconn token call from the official docs once the App Key and Secret are provided.
