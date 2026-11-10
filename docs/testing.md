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

- `npx vitest run`: 12 files, 130 tests, all passing (adds SLA rules, workflow rail, workplace workflows, stored conversation records).
- `npm run test:e2e` against `next start` with demo mode: 13/13 browser checks passed, two consecutive runs, no server errors.
- `npx tsc --noEmit`: no errors.
- `npx eslint .`: no errors.
- `npx next build`: compiled, all pages and routes generated.
- HTTP smoke test against `next start` with `HELLO_DEMO_MODE=true`: the judge scenario, a concurrent-style stale claim,
  attendee and anonymous access checks, and cross-event probes all returned the expected status codes.
- Migration applied to a fresh PostgreSQL 16 database; the database test script printed `ALL DATABASE CHECKS PASSED`.

## Not done

- **Visual regression** snapshots. Layouts were reviewed by screenshot at 390px and 1280px; no automated pixel baseline exists.
- **Browser coverage** is the judge flow and access checks only. Settings, sessions, people search and notifications have no browser test.
- **Accessibility audit** with an automated tool or assistive technology.
- **Load and concurrency tests** against Postgres.
- **Nexconn and AI provider integration tests.** These need credentials and are not written.
