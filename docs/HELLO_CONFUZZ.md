# CON-FUZZ: conference resilience verification

Status: **verified and working** (domain, service, Operations panel, tests). Written 2026-11-22.

CON-FUZZ answers one question for an event supervisor: *if this incident happens, possibly with other things
going wrong at the same time, does the schedule still work, and what is the cheapest change that provably
does?* It never changes the schedule on its own. It stops at a human approval card.

Code: `src/domain/resilience/` (pure: no storage, no clock, no AI), `src/services/resilience.ts` (authority,
approval, execution), `src/components/operations/ResiliencePanel.tsx` (Operations → Resilience tab).

## 1. The bounded world

A world is a versioned description of rooms, sessions, slots and what each disruption acts on. Eight atomic
disruptions, so `2^8 = 256` subsets:

| Bit | Id | What it does in the simulator |
|---|---|---|
| 0 | `demand_surge` | Expected attendance of one session × `surgeFactor` |
| 1 | `primary_room_loss` | One room unavailable |
| 2 | `standby_room_loss` | The standby room unavailable |
| 3 | `step_free_route_closure` | Rooms in one zone lose step-free access |
| 4 | `av_failure` | One room loses AV |
| 5 | `speaker_delay` | One speaker cannot present before slot `delayedUntilSlot` |
| 6 | `speaker_unavailable` | One speaker cannot present from slot `unavailableFromSlot` |
| 7 | `inter_zone_transition_increase` | Walking between zones goes from `walkMinutes` to `increasedWalkMinutes` |

Two kinds of world exist:

- **HELLO v1 benchmark** (`benchmarkWorldV1`): 12 sessions, 5 normal rooms, 1 standby room, 4 slots, 2 zones.
  These are benchmark assumptions, not a venue. `seededWorld(seed)` varies demand and disruption targets for 40
  more worlds (demand is capped at the baseline room's capacity, so every baseline works with no disruption).
- **The live event** (`worldFromEvent`): built from the event's own `Room` and `Session` records, keeping their
  ids, so the proposal, the approval and the schedule update all speak about the same records. Only sessions
  that have not started are included. Stated assumptions: every talk needs AV; `room.accessible` is a
  step-free entrance; expected attendance is enrolment; a room with no upcoming session is the standby room
  (in the demo there is none, so `standby_room_loss` changes nothing there); at least 10 minutes between slots.

The 41-world "monotone" fixture set mentioned in the product brief was **not supplied** with the repository.
HELLO does not claim results on it. The benchmark below uses the v1 world and 40 seeded variations, and each
world's monotonicity is measured, never assumed.

## 2. The simulator `s' = F(s, Δ)`

`simulate(world, schedule, mask)` (`simulator.ts`) applies a fixed playbook, then measures a normalised margin
in `[-1, 1]` for nine constraint families: capacity, room availability, speaker overlap, session overlap, AV
capability, accessibility, step-free route, transition time, hosting (speaker present). A schedule fails
critically iff some margin is `< 0`. Playbook: a session whose room is lost moves to the standby room in the same
slot if it is available and free (handled in slot, then id order); otherwise it has no room. Deterministic: the
unit tests run every mask twice and compare.

## 3. Minimal failing sets and search

A minimal failing set fails while every proper subset passes. The ground truth `M(w)` is computed only by the
offline evaluator `tests/resilience/groundtruth.ts`. `tests/unit/resilience-isolation.test.ts` fails if any file
under `src/` imports it.

Search algorithms (`search.ts`) ask through an `Oracle` that counts each distinct query once; a repeated
identical query is served from the cache at no cost. A budget `B` caps uncached queries.

| Algorithm | Idea |
|---|---|
| `random` | Uniform random subsets; each failure shrunk one disruption at a time |
| `greedy` | From each single disruption, add the one that lowers the worst margin most until failure, then shrink |
| `cardinality` | Walk the lattice bottom-up, skip supersets of found failures. Exact when the budget allows, monotone or not |
| `monotone` | Query top-down first and prune subsets of passing sets. **Used only with a monotonicity certificate** for that exact world and schedule; otherwise falls back to `cardinality` and reports `pruning: disabled` |

Monotonicity (`checkMonotone`) is checked over the whole lattice: adding a disruption must never turn a
failing set into a passing one. The v1 world is **not** monotone, and the report gives the witness:
`inter_zone_transition_increase` fails alone, but adding `primary_room_loss` moves the affected session into the
standby room in the other zone and the walk disappears. That is a realistic effect, so pruning is disabled there.

### Benchmark (measured 2026-11-22, `npx vitest run tests/resilience/benchmark.test.ts`)

41 worlds (v1 + seeds 1–40). 24 of 41 are monotone; every world has at least one failure.

| Algorithm | Budget B | Mean Recall@B | False-robust runs | Mean queries | Wall ms (41 worlds) |
|---|---|---|---|---|---|
| random | 16 | 0.705 | 0 | 16.0 | 13 |
| random | 32 | 1.000 | 0 | 28.5 | 25 |
| random | 256 | 1.000 | 0 | 33.6 | 14 |
| greedy | 16 | 0.294 | 0 | 16.0 | 7 |
| greedy | 32 | 0.915 | 0 | 30.2 | 12 |
| greedy | 256 | 1.000 | 0 | 31.2 | 12 |
| cardinality | 16 | 1.000 | 0 | 15.0 | 7 |
| cardinality | 32 | 1.000 | 0 | 21.0 | 8 |
| cardinality | 256 | 1.000 | 0 | 23.5 | 8 |
| monotone | 16 | 0.733 | 0 | 15.7 | 6 |
| monotone | 32 | 1.000 | 0 | 24.2 | 10 |
| monotone | 256 | 1.000 | 0 | 28.8 | 11 |

`Recall@B = |found ∩ M(w)| / |M(w)|`. A false-robust run is a world with failures where the algorithm found
none of them. These are benchmark metrics over generated worlds, **not** real-world safety probabilities.

Honest reading: in these worlds most minimal failing sets are single disruptions, so bottom-up enumeration is
already cheap and the monotone variant's nine upfront top-down queries cost more than they save. Pruning would
pay off in worlds whose failures need many disruptions together. The service uses the monotone variant only
with a certificate.

## 4. Repair, Critic, exact verification

`resolve(world, baseline, incidentMask)` (`repair.ts`) runs the stages in order:

1. **Reproduce**: simulate the baseline under the incident; list affected sessions and violations.
2. **Discover**: budgeted search for minimal failing sets on the baseline.
3. **Propose**: greedy repair over the sets it must survive (the incident, and the incident plus any one more
   disruption, then every Critic witness). Moves: to a free room/slot, a swap, or an ejection chain (the
   occupant moves on). Sideways moves are allowed across plateaus; visited states are never revisited.
4. **Cost**: `COST_MODEL` in points: 10 per session moved, 0.1 per attendee moved, 5 + 0.05/attendee per time
   change, 3 per zone change, 2 per speaker affected. No saving is quoted without this model.
5. **Critic**: `attack()` tries to break the candidate, starting with supersets of the incident. A claim counts
   only with a simulator witness; a witness goes back to the proposer (bounded rounds).
6. **Exact verification**: `verifyExact()` enumerates all 256 subsets against the exact schedule version. One
   failure fails certification. The certificate carries the world version, schedule version and a digest over
   every outcome. `certificateMatches` rejects it for any other version.
7. **Alternatives**: every cheaper intermediate candidate is verified too and shown with the disruption set and
   constraint that breaks it, and whether the Critic or exact verification found it.

Measured on the v1 world: incidents `step_free_route_closure` and `av_failure` each need one Critic round, then
pass exact verification (about 0.8 s each). A certified fix there moves 8 sessions, because surviving all eight
disruptions at once is demanding; the cheaper rejected plans and their witnesses are listed on the card.

## 5. In the event: approval gate and execution

`runResilienceCheck` (operations staff and organisers, `approval.request`) maps an incident to a disruption
(`INCIDENT_DISRUPTION`: AV → av_failure, CAPACITY → demand_surge, ACCESSIBILITY → step_free_route_closure,
FACILITIES/GENERAL → primary_room_loss, SCHEDULE → speaker_delay) or takes explicit disruptions, runs `resolve`
on the live world, and stores a `scheduleProposal` with the evidence and a count of who would be told.

`decideProposal` (organisers, `approval.decide`, signed-in session only — not an access token, not an agent):

- **Reject**: recorded, nothing changes.
- **Approve**: rebuilds the world from live data; if the world version, baseline version or proposed version
  differ, or re-verification gives another digest, the proposal becomes `STALE` and nothing is applied. Otherwise
  it wins the `AWAITING_APPROVAL → APPROVED` transition once (conditional `docMutate`), updates each moved
  session's room and times, audits with the certificate digest, and notifies only: speakers of moved sessions,
  attendees with a moved session in their plan or a held seat, and operations staff.

Tests: `tests/unit/resilience.test.ts`, `tests/unit/resilience-isolation.test.ts`,
`tests/resilience/benchmark.test.ts`, `tests/integration/resilience.test.ts` (Test E and the stale-certificate
part of Test H).

## 6. Limits

- Live schedule changes are applied session by session (each a single store write), not in one database
  transaction across sessions; the approval itself is decided once. A Postgres transaction spanning the
  updates is listed in the roadmap.
- The live-event world uses the stated assumptions above; venues with a real standby room and per-session AV
  needs should record them on rooms and sessions.
- Grace Period (the two-minute official schedule reconciler) is not built; an approved change is the only
  official schedule change source in this build.
