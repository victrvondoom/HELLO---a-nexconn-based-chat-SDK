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
