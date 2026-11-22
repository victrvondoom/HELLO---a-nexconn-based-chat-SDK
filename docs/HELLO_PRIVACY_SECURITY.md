# Privacy and security for the companion and CON-FUZZ (2026-11-22)

| Rule | How it holds | Test |
|---|---|---|
| A plan is private | `plans` doc per person; live nudges go to the owner only | export/erasure test |
| One person counts once in AV aggregation | One doc per (session, kind, person); claims are conditional writes | `live-room.test.ts` |
| Attendees never see who asked a question | `liveRoom` returns `mine` only, never author ids | `live-room.test.ts` |
| No over-allocation of seats | Check and reserve in one conditional `docMutate` | 10 racers, 3 seats |
| Venue board, room-full display and mark-full are staff-only | `incident.read.operational` | `live-room.test.ts` |
| No schedule change or announcement before approval | `runResilienceCheck` stores a proposal only | `resilience.test.ts` |
| Only an organiser approves, via a signed-in session | `approval.decide`; routes use `viewerRoute` (session cookie), not MCP tokens; no agent tool exists for it | `resilience.test.ts` |
| A stale certificate cannot approve | World, baseline and proposed versions and the digest are re-checked; mismatch → `STALE` | `resilience.test.ts` |
| Ground truth never reaches agent-facing code | Static import check over `src/` | `resilience-isolation.test.ts` |
| Notify only the people concerned | Speakers of moved sessions, attendees with them planned or held, staff | `resilience.test.ts` |
| Room QR grants nothing | It encodes the room URL; sign-in and membership still apply | by construction |
| Care page asks nothing and tells no one | Server-rendered, no write; offline copy holds only venue facilities | by construction |
| Nexconn App Secret never reaches a browser | Only the server reads `NEXCONN_APP_SECRET`; a test scans every client file | `tests/unit/nexconn.test.ts` |
| Export and erasure | `exportCompanion` / `eraseCompanion` (plan, signals, questions, votes, holds) | `live-room.test.ts` |

Rate limits (per person, per instance): live-room taps 40/min, resilience checks 6/min, workflow runs 10/min.
