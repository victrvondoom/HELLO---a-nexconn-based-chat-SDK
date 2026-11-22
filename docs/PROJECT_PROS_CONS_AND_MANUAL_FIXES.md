# HELLO: pros, cons, and manual fixes (index)

Written for: a reader with no prior context, who will decide what to do next.
Status date: 2026-11-22 (persistence hardening pass added). Branch: claude/gracious-fermi-n258g5. Nothing is committed.

## 1. What HELLO is (one line)
Event coordination app: messages, incidents, LiveScene map, LiveShield safety holds, Field Atlas, Moments, games, calls, personal My places (capture, import, photos, check-in visits).

## 2. Verified state (last run)
- Full test suite (memory store): 45 files, 496 tests pass, 3 skipped. Baseline was 44 / 470 / 1. Added: tests/integration/persistence-collections.test.ts (28 tests: 26 run in memory, 2 are Postgres-only and skipped without a database). Run from PowerShell only (see 5.1).
- Postgres suite (npm run test:postgres) against PostgreSQL 18.4, a throwaway local cluster deleted afterwards: 21 files, 265 tests pass, 1 skipped. All six collections (places, visits, imports, liveReports, safetyHolds, placeCollections) covered: round trip, update, delete, event scope, stale-version rejection, reconnect durability. Not a hosted or production database.
- Typecheck (tsc) and ESLint over src and tests: clean.
- Production build: passes.
- Real Chrome flows pass: My places 14/14, capture/import/photo/check-in 17/17, LiveScene HTTP smoke 16/16.
- Site crawl, 34 routes, two roles: no uncaught exceptions, no 5xx.
- Not verified: hosted Postgres, pgbouncer, TLS, failover, backups, load; two separate OS processes on one database for the new collections; native iOS (impossible here); Nexconn live connection (no credentials).

## 3. Pros (keywords)
- Layered architecture: domain (pure rules), services, store contract, routes, UI.
- Two store adapters behind one contract: memory and Postgres.
- Server-side authorization on every service call (capabilities, owner checks, event scope).
- Optimistic concurrency: version compare-and-set on incidents, approvals, places, visits, holds.
- Safety holds: scoped, time-bounded, never auto-released, two-person release rule.
- Privacy: owner-only places; sealed notes (vault, bound context); photos not stored; file names not used; no background location.
- Live updates: content-free nudges over SSE; audience rules per record.
- Rights: export and erasure cover new records.
- Parsers are pure and unit-tested (CSV RFC 4180, Takeout GeoJSON, map links, EXIF GPS built as real bytes).
- Incident lifecycle is an explicit state machine; resolution is read from the incident, never copied.
- Honest UI copy: says what is not verified or not built.
- Real-browser test scripts exist (Playwright plus local Chrome).

## 4. Cons (keywords)
- Default storage is in memory: a restart loses all data unless DATABASE_URL or HELLO_DATA_DIR is set. With DATABASE_URL set and the database down, requests fail (no fallback to memory) and retry on the next request.
- Demo data is seeded and fictional: people, rooms and incidents are illustrative.
- No real Nexconn connection. Only a signed webhook stand-in is tested. Token issuance unknown.
- Scope far larger than built. Brief phases 4-7 (sharing, calendar, agents, full integration) are not built.
- No native iOS. Background location, visits, calendar, photo library and share sheet are not possible here.
- Postgres is verified only on a local throwaway cluster. Hosted Postgres, a connection pooler, TLS, failover, backups and load are untested. Rerun npm run test:postgres on the real target before relying on it.
- Working tree: about 44 changed or new entries, uncommitted. Hard to review.
- Docs drift: older audit docs mention things that are now fixed. Keep them updated.
- Device-key cap is 8 per person; the oldest is retired. Messages sent after that go to the newest device.
- E2EE: no forward secrecy; one key per device (from the earlier audit).
- Rate limits are per process, not shared across instances.
- Text capture matches only known places (venue, saved). It cannot find unknown places.
- Sentinel is keyword matching, not AI. No OCR, no vision, no AI provider configured.
- Times: some pages show local time, LiveScene shows UTC. Inconsistent labels.
- Clustering groups reports by place regardless of category (same space, any kind).
- Performance and battery not measured. No load tests.
- Windows path quirk: vitest fails from Git Bash with /d/ paths; it works from PowerShell with d:\ paths.
- next dev writes a generated block into AGENTS.md; it shows as a modification.

## 5. Manual fixes (step by step)

### 5.1 Run the checks
PowerShell, from the repo folder:
- npx vitest run
- npx tsc --noEmit
- npx eslint src tests
- npm run build
Expected: 45 files passed (496 tests, 3 skipped), tsc and eslint silent, build exits 0. With HELLO_TEST_DATABASE_URL set, npm run test:postgres expects 21 files passed.
If vitest fails in every file, you are in Git Bash. Use PowerShell with d:\HELLO\nexconn-chat-sdk.

### 5.2 Run the app locally
- Stop anything on port 3000 (find the owning process with Get-NetTCPConnection -LocalPort 3000, then stop it).
- Set HELLO_DEMO_MODE=true (demo sign-in is off in production builds without it).
- npm run build, then npm start.
- Open http://localhost:3000/demo, pick Ada, go to My places.
A restart clears data (memory store).

### 5.3 Find the errors you see
- Open the page, press F12, Console tab. Copy the first red line.
- Note the route URL and your role (attendee or organiser).
- Expected, not bugs: 404 on staff-only pages for attendees; 404 on placeholder IDs.
- Real bugs look like: a red uncaught exception, a 500 response, "Something went wrong" text, or a button that does nothing.
- Send those three things (route, role, red line) to get a fix.

### 5.4 Persist data (stop losing data on restart)
- Set DATABASE_URL to a Postgres database. The schema is created on first start.
- Or set HELLO_DATA_DIR to a folder for JSON persistence (single instance only).
- No fallback: if DATABASE_URL is set and the database cannot be reached, requests fail with a generic error and the log shows runtime_start_failed with a reason code. The app never silently serves in-memory data. If HELLO_DATA_DIR is also set it is ignored and data_dir_ignored is logged.
- Tests: HELLO_TEST_DATABASE_URL=postgres://... npm run test:postgres. Use a separate, empty test database (the suite refuses to run if it equals DATABASE_URL, creates one schema per test file and drops only those). In PowerShell: $env:HELLO_TEST_DATABASE_URL='postgres://...'; npm run test:postgres. Details: docs/database.md.

### 5.5 Device-key limit (decision)
Current: at 8 keys, the oldest is retired. Files: src/services/private-messages.ts (publishKey), src/lib/e2ee/keystore.ts.
Option B, if you prefer: raise MAX_KEYS_PER_PERSON (private-messages.ts) and add a settings control to remove devices.

### 5.6 Time labels
Make every page show one time standard: UTC or the viewer's local time. Search for "UTC" in src/components and src/app. LiveScene and places use UTC.

### 5.7 Commit the work safely
- git status; review in groups: product (src/domain, src/services), UI (src/components, src/app), tests, docs.
- Do not commit the AGENTS.md generated block unless you want it; next dev writes it.
- Commit in small commits by area. Run 5.1 before each commit.

### 5.8 Nexconn (when credentials exist)
Read docs/nexconn-integration.md and docs/INTEGRATION_STATUS.md. Implement a ChatTransport against the real SDK (@nexconn/chat is on npm but not yet a dependency). Keep the webhook stand-in tests.

### 5.9 Native iOS (when you have a Mac and a device)
Create a native client. It owns background location, visits, calendar, photo library and share sheet. It talks to the existing HELLO API. Do not claim these in the web app.

### 5.10 Agents (Phase 6)
Specified in docs/HELLO_AGENT_ACCESS_MODEL.md. Not built. Start with the scopes table and the audit table; expose no tool until both exist.

### 5.11 Update stale docs
Refresh docs/IMPLEMENTATION_AUDIT.md and docs/INTEGRATION_STATUS.md against the code. Remove claims that are no longer true.

## 6. Decisions for you
1. Device-key policy: option A (current) or option B.
2. Storage: Postgres now, or keep the demo memory store.
3. Commit now, or keep the working tree uncommitted.
4. Next build: sharing (Phase 4), agents (Phase 6), or stabilise and document only.
5. Nexconn credentials, when available.

## 7. Index of key files
- Places: src/domain/places/rules.ts, capture.ts; src/services/places.ts, place-capture.ts, place-visits.ts
- Live: src/domain/live/rules.ts, cluster.ts; src/domain/graph/*; src/services/live.ts, context-graph.ts
- Permissions: src/domain/permissions.ts
- Store contract: src/store/store.ts; adapters src/store/memory.ts, src/store/postgres.ts
- Rights: src/services/rights.ts
- Live updates: src/lib/live/store.ts, src/lib/live/bus.ts; src/components/live/topics.ts
- Docs: docs/context-graph.md, docs/HELLO_LIVING_ATLAS_*.md, docs/ANYWHERE_FEATURE_AUDIT.md, docs/TEST_EVIDENCE.md
