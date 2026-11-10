# HELLO — One conversation. Everyone connected.

HELLO is an AI-assisted coordination layer for physical events. An attendee describes a problem in
ordinary words ("The microphone in Room 3 has stopped working."). HELLO works out the room, session and
team concerned, checks whether someone already reported it, routes it to staff with the right skill,
keeps a record of every step, and asks the reporter to confirm when it is fixed.

> **Status: working prototype, not a production system.** The domain logic, workflows and UI are
> implemented and tested. Persistence is an in-memory demo store, messaging is not connected to Nexconn,
> and sign-in is a demo shortcut. See [Status](#status) before using this for a real event.

## The problem

Physical events run on disconnected channels: informal messages, several inboxes, volunteers who don't know
what is already being handled, technicians who receive half a description, and attendees who never learn
whether anyone is acting. HELLO's premise is that every important conversation should be able to become an
accountable workflow.

## What it does (implemented)

- **One conversation for every role.** Attendees, speakers, volunteers, operations and organisers use the
  same entry point. What they can see and do depends on their membership.
- **Incident intelligence.** Messages become incidents. A report matching an open incident (same room,
  category, within 30 minutes) is attached to it, with its match confidence and signals. Each person's
  report is kept. Reports are never merged on wording alone.
- **Lifecycle.** REPORTED → TRIAGED → ASSIGNED → ACKNOWLEDGED → IN_PROGRESS → RESOLVED → CONFIRMED → CLOSED,
  plus REOPENED, CANCELLED, NEEDS_INFORMATION and ESCALATED. Moves are checked on the server against the
  state machine and against who is making the move.
- **Assignment.** Eligible staff are ranked by skill, workload, availability and location. Each score
  shows its reasons. Claims are version-checked, so two simultaneous claims cannot both succeed.
- **Capacity-aware alternatives.** Sessions that are full, ended, inaccessible (when required) or clash with
  the person's schedule are excluded. Remaining sessions are scored with configurable weights and explained.
- **Approvals.** A consequential change (moving a session to another room) is requested by HELLO only when
  over-capacity is recorded and two or more independent people report it. An organiser must approve it.
  Approval and execution are recorded separately, so an approved move can still fail, and the UI says so.
- **Signal intelligence.** Three or more independent reporters of the same category in one room within ten
  minutes produce a suggested insight. It is built only from stored reports, counts each person once, and
  waits for an organiser's review. Review decisions are not overwritten by later recomputation.
- **People discovery.** Search by declared interest. Only people who opted in appear, the matched interest is shown,
  and no contact details are exposed.
- **Operations view.** Rooms with occupancy and its data source, open incidents, the approval queue and signal review.
- **Honest data labels.** Every occupancy figure states whether it is live verified, administrator entered,
  attendee reported, or demo data.

## Workplace features

Everything on these screens is computed from current state when it is requested, and the live screens refresh
themselves while the tab is visible. Nothing is a stored snapshot.

- **Today**: the event home. Your open requests, next sessions, unread updates and the latest announcement. Staff
  also see what is waiting on the team and what is assigned to them.
- **Acknowledgement timers**: every incident has a target from its urgency (critical 5 min, high 10, medium 30, low 60).
  Timers move from on track, to at risk, to overdue. The reporter sees the same target for their own report.
- **Escalation check**: unclaimed work past its target is escalated through the normal lifecycle rules, recorded in the
  timeline and the audit trail, and notified to operations. A second press changes nothing that is already escalated.
- **Workflow rail**: each incident shows its stages (reported, triaged, assigned, in progress, resolved, confirmed),
  derived from its status so it cannot disagree with the lifecycle.
- **Team**: availability, skills, zone and load for each staff member, ordered so available people come first. Staff
  set their own availability; off-shift people are not recommended for new work.
- **Profile and privacy**: interests and discoverability are the only things people search uses. Turning discoverability
  off removes you from search at once.
- **Announcements**: proposed by a staff member, published only after a different organiser approves, through the same
  approval and execution records as room changes.
- **Notifications**: unread counts in the navigation, and mark-as-read.
- **Audit trail**: organisers see every consequential action, filterable by action. Entries cannot be edited.
- **Conversation search** and incident search and filters.

## Architecture

```
UI (App Router pages, client components for interaction)
  → API routes (validate with Zod, resolve viewer, map errors)
    → Services (permissions, use cases, optimistic concurrency)
      → Domain (pure rules: lifecycle, classification, duplicates, scoring, approvals, signals)
      → AI (validated intent routing; deterministic fallback)
      → Store (HelloStore contract: in-memory now, Postgres planned)
```

Details: [docs/architecture.md](docs/architecture.md).

## Technology

- Next.js 16 (App Router), React 19, TypeScript in strict mode
- Zod 4 for every external input
- Vitest for unit and integration tests; ESLint with strict type-checked rules
- PostgreSQL / Supabase: migration, constraints, RLS and tests written (see [docs/database.md](docs/database.md))
- Nexconn: configuration boundary only (see [docs/nexconn-integration.md](docs/nexconn-integration.md))

## Repository structure

```
src/
  app/                   Pages (App Router) and API route handlers
    api/                 Thin HTTP adapters over services
    events/[eventId]/    Event pages: conversation, incidents, operations, sessions, people, …
  components/           Client and server UI components
  domain/               Pure business rules (no framework or I/O imports)
    incidents/          lifecycle, classification, duplicate detection
    assignments/        explainable assignment scoring
    sessions/           capacity-aware session recommendation
    approvals/          trust levels, four-eyes rule, execution rules
    intelligence/      signal pattern detection
    notifications/      dedupe keys
    permissions.ts      capability table and authorize()
  services/             Use cases; the only layer that writes state
  store/                HelloStore contract, in-memory implementation, demo seed
  ai/                   Intent schema, provider boundary, deterministic interpreter
  integrations/nexconn/ Configuration status (no live connection)
  lib/                  Runtime, sessions (demo), HTTP envelope, validation, rate limiting, logging
supabase/
  migrations/           0001_core_schema.sql
  seed.sql              Demo event structure (labelled)
  tests/                Database constraint and RLS checks
tests/
  unit/                 Domain and AI boundary tests
  integration/          Service-level workflow tests (judge demonstration and more)
docs/                   Architecture, database, Nexconn, AI, security, deployment, testing
```

## Prerequisites

- Node.js 20.9 or later (tested with Node 22)
- npm (tested with 10)
- PostgreSQL 15+ only if you want to apply and test the database layer

## Installation and local run

```bash
npm install
cp .env.example .env.local          # then set HELLO_DEMO_MODE=true
npm run dev                         # http://localhost:3000
```

Open `/`, choose **Enter the demo event**, pick a demo account, and use the conversation.

## Browser test

```bash
HELLO_DEMO_MODE=true npm run build && HELLO_DEMO_MODE=true npm start   # terminal 1
CHROMIUM_PATH=/path/to/chromium BASE_URL=http://localhost:3000 npm run test:e2e   # terminal 2
```

The suite resets the demo first (`POST /api/demo/reset`), so it is repeatable. `CHROMIUM_PATH` is optional when
Playwright's own browser is installed.

## Demo walkthrough (judge scenario)

1. Sign in as **Ada (demo attendee)** and send: `The microphone is not working, and there are too many people in Room 3.`
2. The reply shows two concerns: an AV incident and a capacity concern. Both attach to the existing reports for Room 3,
   each with its match confidence. Alternative sessions are listed, and a room change is sent to an organiser.
3. Switch to **Kiri (demo AV technician)**, open *Incidents*, and claim *Microphone crackling in Room 3*.
   Staff ranking shows Kiri first, with reasons.
4. Acknowledge, start work, then mark resolved with a description.
5. Switch back to Ada, and confirm the fix (or reopen it). Confirmation closes the incident.
6. Switch to **Nadia (demo organiser)**, open *Operations and approvals*, and approve the room move. It executes
   against the stored schedule and records the result. (A request for a room that is already booked fails and says why.)
7. Signal intelligence needs three independent reporters inside ten minutes. Have two more demo attendees report an audio
   fault in Room 3, then press *Recompute from stored reports*. The insight appears for organiser review, not as an action.

Every figure in the demo is seeded, illustrative data and is labelled as such.

## Environment configuration

See [`.env.example`](.env.example). Only `HELLO_DEMO_MODE` and `NEXCONN_APP_KEY` are read by this build.
Supabase and AI variables are listed for the production wiring but are not read yet.

## Database setup

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/0001_core_schema.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/seed.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/0001_constraints_and_rls.sql
```

The migration was applied to a fresh PostgreSQL 16 database and the test script passed. The app does not use this
database yet. See [docs/database.md](docs/database.md).

## Nexconn setup

Obtain an app key from the Nexconn developer console and set `NEXCONN_APP_KEY`. This currently only changes the
status message shown in **Settings**. The SDK is not installed and no connection is made. See
[docs/nexconn-integration.md](docs/nexconn-integration.md) for the verified SDK surface and the remaining steps.

## AI provider setup

No provider is connected. HELLO uses its deterministic interpreter, and every interpretation says which source
produced it. To add a provider, implement `IntentProvider` in `src/ai/intent.ts`. Its output must pass the schema,
and it must never return actions. See [docs/ai-system.md](docs/ai-system.md).

## Commands

```bash
npm run dev         # development server
npm test            # unit and integration tests (138)
npm run test:e2e    # browser checks: judge flow (13), workplace features (10), workflow audit (22); needs a running server
npm run test:routes # visits every page as every demo role and reports server and page errors
npm run typecheck   # TypeScript
npm run lint        # ESLint
npm run build       # production build
npm run check       # typecheck, lint, test and build
npm start           # serve the production build
```

## Production build and deployment

`npm run build` completes. For Vercel, use the default Next.js build with Node 20.9+, and set the environment
variables in the dashboard. **Do not deploy a live event on this build**: data is in memory, so each serverless
instance has its own copy, and demo sign-in is not authentication. See [docs/deployment.md](docs/deployment.md).

## Status

| Area | Status |
|---|---|
| Incident intake, duplicate matching, lifecycle, claims, resolution, confirmation, reopening | Implemented and tested (unit + integration) |
| Assignment ranking | Implemented and tested |
| Capacity-aware session alternatives | Implemented and tested |
| Approvals with separate execution | Implemented and tested (one executor for room moves, one for announcements) |
| Signal intelligence with human review | Implemented and tested |
| People discovery with consent | Implemented and tested |
| Notifications with dedupe (in-app list) | Implemented and tested; no email, push or Nexconn delivery |
| Role-aware UI, operations view, incident detail | Implemented; checked over HTTP, not in a browser |
| Database schema, constraints, RLS | Written; verified on PostgreSQL 16; **not yet used by the app** |
| Persistence | **In-memory demo store only** |
| Sign-in | **Demo shortcut only**, not authentication |
| Nexconn messaging | **Not connected** |
| AI provider | **Not connected**; deterministic interpreter in use |
| Browser end-to-end test of the judge flow (13 checks, Playwright) | Implemented; run against a demo server |
| Visual regression, accessibility audit, load tests | **Not done** |
| Equipment/resource management, staff directory, announcement management, admin screens, audit log UI, session seat holds | **Not built** |
| Personal schedule planner | **Not built**; clash checks use only the current session |

## Security

Server-side authorisation on every write, cross-event isolation, attendee privacy, append-only audit,
four-eyes approvals, and RLS policies are implemented. Known limitations are listed in
[docs/security.md](docs/security.md) and must be resolved before any real use.

## Licence

No licence has been chosen for this repository yet. Nexconn SDK packages are distributed under their own licences.
