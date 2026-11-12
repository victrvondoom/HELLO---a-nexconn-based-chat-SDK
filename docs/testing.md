# Testing

## Commands

```bash
npm test                 # unit + integration tests (Vitest)
npm run typecheck        # TypeScript, strict mode
npm run lint             # ESLint with strict type-checked rules
npm run build            # production build
npm run check            # all of the above, in order
```

Database checks (requires PostgreSQL and the Supabase stand-ins; see docs/database.md):

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/0001_constraints_and_rls.sql
```

## What is covered

| Area | Where | Notes |
|---|---|---|
| Incident lifecycle | `tests/unit/lifecycle.test.ts` | Legal and illegal moves, actor gating, terminal states. |
| Classification | `tests/unit/classify.test.ts` | Categories, equipment, urgency, room resolution, false-positive cases. |
| Duplicate detection | `tests/unit/duplicates.test.ts` | Hard gates (room, category, time, open status, equipment), no merge on text alone. |
| Assignment scoring | `tests/unit/scoring.test.ts` | Eligibility, weights, technical-skill rule, workload limit. |
| Session recommendation | `tests/unit/scoring.test.ts` | Full, inaccessible, ended, current, schedule-conflict exclusions; weights. |
| Permissions and approvals | `tests/unit/permissions-approvals.test.ts` | Capabilities, cross-event denial, four-eyes, expiry, execution rules. |
| Signal intelligence | `tests/unit/signals-notifications.test.ts` | Distinct reporters, windows, confidence cap, determinism; notification dedupe. |
| AI boundary | `tests/unit/intent.test.ts` | Judge sentences, schema validation, timeout, rate limit, provider error. |
| Workflows | `tests/integration/workflows.test.ts` | Judge demonstration, concurrent claims, full lifecycle, reopening, isolation, approvals, signals, people, degradation. |
| Browser (workplace) | `tests/e2e/features-flow.mjs` | 10 checks: live board, escalation, team, availability, audit access, consent, announcement approval chain, read state, search, workflow rail. |
| Browser (judge flow) | `tests/e2e/judge-flow.mjs` | 13 checks: sign-in, two-concern report, persisted reply, claim, approval, phone overflow, access. |
| Database | `supabase/tests/0001_constraints_and_rls.sql` | Constraints, append-only audit, RLS for strangers, attendees and organisers. |

## Verified results (this build)

- `npx vitest run`: 18 files, 187 tests, all passing (adds SLA rules, workflow rail, workplace workflows, stored conversation records, room follow-up, classification regressions).
- Workflow audit (`tests/e2e/workflow-audit.mjs`): 22 steps across seven roles, including the room follow-up, the 'waiting on you' prompts, cancellation through the confirm dialog, and off-shift refusal.
- Route crawl (`tests/e2e/route-crawl.mjs`): every page as every role. Expected responses are 200 for permitted routes and 404 for forbidden ones; anything else is reported. The expected access for each role is written in the script (`expectDenied`), so a forbidden page that loads is reported as well as a permitted page that fails.
- Screenshots (`tests/e2e/screenshots.mjs`, `npm run screenshots`): captures the README images from the seeded demo at 1280px and 390px.
- `npm run test:e2e` against `next start` with demo mode: judge flow 13/13, features 10/10, workflow audit 22/22, private messages 6/6, no page or server errors.
- `npm run test:routes`: 250 page visits (25 routes × 10 roles), 45 correctly denied, 0 problems.
- `npx tsc --noEmit`: no errors.
- `npx eslint .`: no errors.
- `npx next build`: compiled, all pages and routes generated.
- HTTP smoke test against `next start` with `HELLO_DEMO_MODE=true`: the judge scenario, a concurrent-style stale claim,
  attendee and anonymous access checks, and cross-event probes all returned the expected status codes.
- Migration applied to a fresh PostgreSQL 16 database; the database test script printed `ALL DATABASE CHECKS PASSED`.

## Not done

- **Visual regression** snapshots. Layouts were reviewed by screenshot at 390px and 1280px; no automated pixel baseline exists.
- **Browser coverage** is the four Playwright suites and the route crawl. The venue map interactions (3D and heat views, step-free routing) and data erasure have no interactive browser test; the map pages are only loaded by the route crawl.
- **Accessibility audit** with an automated tool or assistive technology.
- **Load and concurrency tests** against Postgres.
- **Nexconn and AI provider integration tests.** These need credentials and are not written.
