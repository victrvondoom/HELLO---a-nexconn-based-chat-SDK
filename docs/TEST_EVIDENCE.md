# Test evidence

Recorded on 2026-11-17 on branch `claude/eager-ritchie-argdtp`. Each row is a command that was run, with its result.
A failing run is recorded here too. Nothing is marked as passing without a run.

## Automated checks

| Command | Result |
|---|---|
| `npm run typecheck` | pass (no errors) |
| `npm run lint` | pass (no errors) |
| `npx vitest run` | 23 files, 252 tests, all pass |
| `npm run build` | pass |
| `node tests/e2e/field-atlas-flow.mjs` | **19 of 19 browser checks pass** |
| `node tests/e2e/judge-flow.mjs` | 13 of 13 pass |
| `node tests/e2e/features-flow.mjs` | 10 of 10 pass |
| `node tests/e2e/workflow-audit.mjs` | 22 of 22 pass |
| `node tests/e2e/private-messages.mjs` | 6 of 6 pass |
| `node tests/e2e/product-flow.mjs` | all checks pass |
| `node tests/e2e/route-crawl.mjs` | pass: visited 250 pages, 45 correctly denied, 0 problems |

The E2E suites run against `HELLO_DEMO_MODE=true npx next start -p 3000` after `npm run build`.

## What the Field Atlas tests prove

Unit (`tests/unit/field-rules.test.ts`, 19 tests): level thresholds and determinism; levels blocked by an achievement;
inactive levels; level-table validation; achievement rules; UTC month boundaries including leap years; the exact
season boundary millisecond; mission availability reasons; the verification policy; evidence normalisation; mission
schema rules (location or explicit non-location, XP cap, no self-prerequisite, one completion per person).

Integration (`tests/integration/field-atlas.test.ts`, 27 tests) against the real services and the in-memory store:
- Locks show their reason. Drafts are invisible to attendees. A non-member is refused.
- Check-in: wrong code refused with no XP; expired code refused and flagged; correct code awards once; a repeat
  submission awards nothing.
- Workflow mission: verified only after a real succeeded run of that workflow.
- Concurrency: eight simultaneous submissions award XP exactly once. Eight simultaneous starts create one attempt.
- Manual evidence: pending adds no XP; a reviewer approves it once; a second approval is refused; a rejected
  submission can be resubmitted up to the limit; a fourth submission is refused.
- Duplicate evidence from two people is flagged and neither is approved automatically.
- Level unlock from verified XP; monthly badge and season bonus awarded once; badge kept after the season ends;
  a mission cannot be started after its window.
- Organiser level changes are versioned and audited. Permissions: attendees cannot change missions, levels, seasons,
  stations, XP or reviews; operations staff can review but cannot change rewards; XP adjustments need a reason and are audited.
- Quest Director: drafts from real rooms and stations; gaps reported; auto-publish limited to low-risk drafts;
  refuses an ended month; routes use the venue graph and step-free routing; guide answers cite their records.
- Data rights: export includes Field Atlas progress; erasure removes the person's records and leaves others' untouched.

Browser (`tests/e2e/field-atlas-flow.mjs`), three real sessions (organiser Nadia, attendees Ada and Ben):
1. The organiser issues check-in codes at three stations, and the codes are read from the page.
2. Ada opens Field Atlas: six missions in the list, three markers on the ground floor, the level header, and the season.
3. A locked mission explains why it is locked and offers no Start button.
4. A marker is operated with the keyboard (Enter), and the mission panel opens.
5. A wrong code is refused and XP stays at 0. The correct code is verified: +30 XP appears without a reload.
6. Resubmitting the completed mission returns `ALREADY_COMPLETE` with 0 XP.
7. Ada runs the “Plan my day” workflow on the real canvas. Her mission then verifies: +25 XP.
8. The level-one mission stays locked until XP is verified.
9. The organiser records an audited +50 XP adjustment with a reason.
10. Ada submits manual evidence. It waits for review and adds no XP. The organiser approves it and XP is awarded once.
11. A second approval of the same evidence is refused.
12. Ada completes the other required missions. The response says `+160 XP` (60 mission XP plus the 100 XP
    season bonus), and the response lists the monthly badge and two permanent achievements.
13. The badge is in the cabinet after two full page reloads.
14. Ada cannot open the management page, and a direct API call to change XP is refused with 403. Her XP is unchanged.
15. Ben's API read shows no progress for Ada's account.
16. At 390 px width the page has no horizontal overflow.
17. The page has no uncaught errors in the browser console.

Screenshots from the last run, in the session scratchpad: `shots/verified-checkin.png`, `shots/badge-unlocked.png`,
`shots/cabinet.png`, `shots/manage-codes.png`, `shots/mobile.png`.

## Bugs found by this testing, and fixed

- The atlas API omitted the venue width and height, so the map's SVG viewBox became `undefined` after the first
  15-second refresh. Fixed in `src/app/api/events/[eventId]/atlas/route.ts`.
- The submission rate limiter survived a demo reset, so back-to-back runs were refused. A demo reset now clears every
  limiter (`resetAllRateLimiters` in `src/lib/rate-limit.ts`, called from `resetRuntime`). The limiter's message had
  also said “sending messages”; it now has its own text for check-in submissions.
- The Quest Director drafted a season before its missions existed, so validation rejected it. The season is now
  written first and updated with the saved missions.
- Missing store fields in `src/store/memory.ts` (baseline repair, see the commit `7257042`).

## Not verified, and why

- Live Nexconn messages, live AI model output, and Postgres: not connected in this environment (see
  `docs/INTEGRATION_STATUS.md`). No test here claims otherwise.
- Browser push notifications: not implemented.
- Two real browsers in separate devices: the E2E uses separate browser contexts, which share a server but not cookies.

## UI restoration pass (2026-11-17, later)

Cause: a merge (`9314457`) had dropped about 270 lines of the design system from `src/app/globals.css`: `.panel`,
`.tile`, `.tile-grid`, the flow canvas nodes, feed posts, call tiles, the payment tickets, and the floor styles. Thirty
files use those classes, so the games, feed, canvas and payment screens were unstyled. The restore reverses the
exact removed lines from `4951e9c`, re-adds the ticket and floor styles from `b328f4d` and `645a427`, and adds the
standard `sr-only` utility. Field Atlas styles are kept on top.

Checks after the restore: `npm run check` passes (252 tests, build). Field Atlas browser journey 19/19 when run alone.
Existing suites pass: judge-flow 13/13, features-flow 10/10, workflow-audit 22/22, private-messages 6/6, product-flow passes.

Note: running the browser suites in parallel against one server makes them reset each other's state. Run them one at a time.

## Defect sweep and the Field Atlas live layer (2026-11-19)

Starting point: typecheck, lint, 252 tests, build, all six browser journeys and a 330-page crawl all passed. The
defects below were found by reading each service against its stated invariants, then proven with a test that fails
on the old code and passes on the fix (`tests/integration/field-live.test.ts`, `tests/unit/rate-limit.test.ts`).

### Defects fixed

| # | Where | Defect | Fix |
|---|-------|--------|-----|
| 1 | `field-atlas.ts` `flag` | Each submit after the 3-submission limit wrote a new `REPEATED_SUBMISSIONS` flag (random id), flooding the review queue. | One open flag per person, mission and kind. The id is a hash of the source plus the dismissed count, so it does not carry the user id after erasure, and a fresh occurrence after a dismissal is flagged again. |
| 2 | `field-atlas.ts` `awardMission` | Only `mission.seasonId` was checked for a season bonus. A season that requires a mission from another season (allowed by `saveSeason`) never awarded its badge. | Every season that requires the mission is checked. |
| 3 | `field-atlas.ts` `awardMission` | DRAFT and PAUSED seasons could award bonus XP and badges. | Only PUBLISHED seasons award. |
| 4 | `field-atlas.ts` `seasonsForViewer` | "Required left" counted approvals from outside the season window, so it could say 0 while the badge rule refused the award. | Same window rule as the award. |
| 5 | `field-atlas.ts` `adjustXp` | A negative adjustment could make total XP negative ("-40 XP"). | Refused with the current total in the message. |
| 6 | `field-atlas.ts` `submitMission` | When a concurrent submission used the last attempt, the conditional write did nothing but the reply still said "submitted". | The reply is a VERSION_CONFLICT when the write did not happen. |
| 7 | `atlas/reviews/[attemptId]/route.ts` | `decodeURIComponent` on an already-decoded param threw `URIError` for any `%`: HTTP 500 (`URI malformed` in the server log). | Decoded once only if it still looks encoded, and never throws. Now 404. |
| 8 | `quest-director.ts` `draftMonthlyChallenge` | A re-draft saved new missions with the season's id but left them out of the season. Dead `requiredMissionIds` code was immediately overwritten. | New missions are appended (requirements only while the season is a draft, so a live challenge never gets harder). |
| 9 | `rate-limit.ts` | The `hits` map kept every key (user, address, handle) for the life of the process. | Expired windows are swept once the map passes 1,024 keys. |
| 10 | `rate-limit.ts`, `http.ts`, `errors.ts` | 429 responses had no `Retry-After`. | `DomainError` carries `retryAfterSeconds`, sent as `Retry-After`. |
| 11 | `rate-limit.ts` | The reset registry was module-scoped, so it depended on the bundler loading one copy of the module. | Kept on `globalThis`, like the runtime. Hardening: in this production build the reset already worked (checked against the old server). |
| 12 | `atlas/page.tsx` + `atlas/route.ts` | The first render and the poll built the atlas payload separately (the cause of the earlier viewBox bug). | One `atlasHome` service used by both. |
| 13 | `FieldAtlas.tsx` | Evidence text and check-in code typed for one mission carried over to the next; the map stayed on the wrong floor. | Cleared on selection; the map moves to the mission's floor. |
| 14 | `live/client.ts` `useLive` | A tab that had been hidden showed data up to one poll interval old after being shown again. | Refreshes on `visibilitychange`. |
| 15 | `tests/e2e/field-atlas-flow.mjs` | Screenshot folder was hard-coded to one machine's scratchpad path. | `SHOT_DIR` or the system temp directory. |
| 16 | `tests/e2e/route-crawl.mjs` | Eight pages were never crawled (atlas, atlas/manage, communities, calls, games, feed, flow, live-map). | Added. 330 page loads, 0 problems. |

### New: Field Conditions and Season Pulse

`src/domain/field/live.ts` (pure rules), `src/services/field-live.ts`, wired into the atlas home, the map, the
mission panel, the field guide and Quest Director's ranking.

- `tests/unit/field-live.test.ts`: levels per incident category and urgency, crowding thresholds, running sessions,
  incident text never present, step-free penalty for access issues, k-anonymity suppression below 3, people counted
  once, the one-hour window.
- `tests/integration/field-live.test.ts`: Room 3 is AVOID from real seed data (open AV and crowding incidents, 52/40
  occupancy) with no report text or incident ids; resolving incidents removes them at once; a 200 XP mission in
  Room 3 is not ranked first and its field guide says to come back later; the pulse appears only at 3 people and fades
  after an hour.
- `tests/e2e/field-live-flow.mjs`, 8/8 in Chromium: advisory on the map, no report text, panel and pulse rendered,
  staff cancel the incidents in another session and the attendee's map drops them on the next poll without a reload,
  momentum appears after three real completions, no overflow at 390 px, no console errors.
  Screenshot: `docs/screenshots/field-atlas.jpg` (Field Atlas page; regenerated with the Meadow redesign).

### Results after the change

`npm run typecheck`, `npm run lint`: clean. `npm test`: 26 files, 275 tests. `npm run build`: passes. Browser:
judge-flow 13/13, features-flow 10/10, workflow-audit 22/22, private-messages 6/6, product-flow passes,
field-atlas-flow 19/19, field-live-flow 8/8, route crawl 330 pages / 0 problems. Run against `next start` on port
3000 with `HELLO_DEMO_MODE=true`.

## Second pass: audit fixes and the missing pieces (2026-11-19, later)

### Defects fixed (each with a test that fails on the old code)

| Where | Defect |
|---|---|
| `services/mcp.ts` | MCP write tools had their own 120/min per-token limit; with ten tokens a person could send 1,200 messages, posts or workflow runs a minute. Now shared per-person limits (`lib/action-limits.ts`). |
| `services/incidents.ts` | Two people reporting the same problem at once: the second got VERSION_CONFLICT and its report had no timeline entry. The equipment merge now retries. |
| `services/pipeline.ts` | "What is on in Room 4?" listed sessions with blank times (`.slice(11)` on a 9-character string). |
| `services/approvals.ts` | Approval notifications linked to `/operations/approvals`, a 404. |
| `services/approvals.ts` | De-duplication compared JSON strings; on Postgres (JSONB sorts keys) every repeat looked new. |
| `services/payments.ts` | The daily cap was checked before claiming, so drafts confirmed together could all pass it. New PROCESSING state; checked after claiming. |
| `services/rights.ts` | Erasure left the person's notifications and their payment notes. |
| `services/feed.ts` | Deleting a post deleted media another post still used. |
| `services/games.ts` | Quizzes never closed; five quiz rounds locked a person out of starting any game, forever. |
| `services/location.ts` | Country counts of one or two people were shown, which identifies them. Hidden below three. |
| `lib/persistence.ts` | A save pending at shutdown was lost. Flushed on exit. |
| `store/memory.ts` | Update patches were stored without copying. |
| `services/location.ts` | `setCountry` replaced the whole preferences record. |

### New, with evidence

| Piece | Tests |
|---|---|
| Postgres store | `npm run test:postgres`: 170 pass, 1 memory-only skip; `store-contract.test.ts`; all journeys on Postgres; restart durability checked |
| Live push, presence, typing | `tests/unit/live.test.ts` (13), `tests/integration/live.test.ts` (incl. LISTEN/NOTIFY across two stores), `tests/e2e/live-flow.mjs` 9/9 on one server and across two server processes |
| Chat gateway | `tests/integration/chat-gateway.test.ts` (15, both stores, real HTTP receiver), `tests/e2e/chat-bridge-flow.mjs` 9/9 |
| Search | `tests/integration/search.test.ts` (6) |
| Time-zone seasons, leaderboard, outbox | `tests/unit/season-timezone.test.ts`, `tests/integration/leaderboard-outbox.test.ts`, `tests/e2e/outbox-flow.mjs` 3/3 |
| Two-person video call | `tests/e2e/call-flow.mjs` 4/4: each browser receives the other's frames |
| Media magic bytes | `tests/integration/audit-fixes.test.ts` |

### Totals at the end of this pass

`npm run typecheck`, `npm run lint`: clean. `npm test`: 34 files, 340 pass, 1 skipped (Postgres-only). `npm run build`:
passes. `npm run test:e2e`: 10 journeys pass (judge 13/13, features 10/10, workflow 22/22, private messages 6/6,
product, Field Atlas 19/19, field live 8/8, live 9/9, outbox 3/3, call 4/4). Route crawl: 330 pages, 0 problems.

Not run here: HawkScan (no `HAWK_API_KEY` in this environment). CI has not run yet on GitHub at the time of writing.
