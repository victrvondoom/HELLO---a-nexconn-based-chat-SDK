# Database

## Status

| Piece | Status |
|---|---|
| `supabase/migrations/0001_core_schema.sql` | Written. Applied to a fresh PostgreSQL 16 database and verified (see below). |
| `supabase/tests/0001_constraints_and_rls.sql` | Written and passing: constraint, append-only audit and RLS checks. |
| `supabase/seed.sql` | Written and applied. Event, rooms and sessions only. |
| Postgres-backed `HelloStore` | **Written and used**: `src/store/postgres.ts`, schema `src/store/postgres-schema.ts`. Set `DATABASE_URL`. `npm run test:postgres` runs the whole integration suite on it. |
| Demo people in the database | **Not seeded.** They need Supabase Auth accounts, which the seed cannot create. The in-memory demo provides them. |

## Verified

```bash
# PostgreSQL 16, fresh database with Supabase stand-ins (auth schema, auth.uid()).
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/0001_core_schema.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/seed.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/0001_constraints_and_rls.sql
```

The migration creates 14 tables, all with RLS enabled. The test script prints `ALL DATABASE CHECKS PASSED`.

## Design decisions

- **Typed operational state.** Status, category, role, approval and execution states are enums. The
  incident/approval lifecycle is enforced in the application state machine. The database checks the invariants
  that must hold regardless of code path, such as "a resolved incident has a resolution note" and
  "a requester cannot approve their own request".
- **Occupancy always has a source.** `rooms_occupancy_has_source` rejects an occupancy figure without a
  `data_source`, so a demo or reported number cannot appear as a measurement.
- **One pending approval per payload.** A partial unique index on `(event_id, action_type, md5(payload))`
  stops duplicate organiser requests.
- **Audit is append-only** via a trigger that rejects `UPDATE` and `DELETE`.
- **JSONB only for flexible data:** the message interpretation and the approval payload. Both are validated by the application.

## Not yet in the schema

From the requested model, these are not implemented: `conversations`, `conversation_participants`,
`message_attachments`, `conversation_context`, `venues`, `equipment`, `resources`, `room_capacity` (history),
`schedule_changes`, `staff_skills`/`staff_availability` as separate tables (skills and availability are columns on
`memberships` for now), `expertise`/`interests` tables (interests are a column on `profiles`), `recommendations`,
`recommendation_feedback`, `webhook_events`, `integration_events`, `idempotency_records`, `detected_patterns`
(the current table is `signal_patterns`). They should be added with their own migrations once the
features that need them exist.

## Applying in Supabase

1. Create the project, then run the migration with the Supabase CLI or the SQL editor.
2. Run `supabase/tests/0001_constraints_and_rls.sql` against a non-production branch.
3. Create demo auth accounts if you want the demo people, then insert their `profiles` and `memberships`.
4. Do not run `supabase/seed.sql` against a production project.

## The app's store on Postgres (2026-11-19)

`src/store/postgres.ts` implements the full `HelloStore` contract with the in-memory store's exact semantics:

- One table per record kind: the columns the store queries and indexes, plus the whole record as `data jsonb`, so a
  record comes back exactly as written. `seq` keeps insertion order, which several lists rely on.
- Every read-modify-write (`docMutate`, the version-checked updates of incidents, approvals and payments) runs in a
  transaction that locks the row first. That also holds across several app instances.
- The database enforces one notification per (event, dedupe key), one follow per pair, one document per id.
- The schema is created on first start under an advisory lock, so instances can start together. An empty database
  gets the demo event. The demo reset truncates every table.
- `LISTEN/NOTIFY` carries live updates and presence between instances (`src/lib/live/fanout.ts`).

Verified: `npm run test:postgres` (every integration test, one schema per test); `tests/integration/store-contract.test.ts`
(25 concurrent mutations, one winner of insert-if-absent and of a version race); all browser journeys against `next start`
on Postgres; an account and a post survive a restart; two server processes share live updates.

Found by running on Postgres: approval de-duplication compared JSON strings, which depend on key order, and JSONB sorts
keys. Payloads are now compared by content.

The Supabase migration in `supabase/` is a separate relational design for a Supabase Auth deployment.

## Storage selection and failure behaviour (2026-11-22)

The adapter is chosen once, at start, from the environment (`src/lib/runtime.ts`):

| Environment | Adapter | Survives a restart | If the store cannot start |
|---|---|---|---|
| `DATABASE_URL` set | Postgres (`HELLO_DB_SCHEMA`, default `public`) | Yes | Requests fail with a generic error; the log has `runtime_start_failed` and a reason code (for example `ECONNREFUSED`). The app does **not** fall back to memory, and retries on the next request. |
| `HELLO_DATA_DIR` set (no `DATABASE_URL`) | Memory, saved to `state.json` and `blobs/` | Yes, one instance only. The last 400 ms of writes are flushed on exit | An unreadable `state.json` stops the start; nothing is silently replaced |
| Neither | Memory | **No.** Everything is lost on restart | n/a |

If both `DATABASE_URL` and `HELLO_DATA_DIR` are set, Postgres wins and `data_dir_ignored` is logged.
`HELLO_DEMO_MODE` only decides whether demo sign-in is offered (and the demo event is what an empty store is seeded with).
It does not choose the storage. Connection strings and passwords are never logged or shown in the UI.

Local persistent storage: create an empty database, then `DATABASE_URL=postgres://user:pass@localhost:5432/hello`
(set it in your shell or `.env.local`, which is not committed) and `npm run build && npm start`. The schema is created on first start.

Tests: `HELLO_TEST_DATABASE_URL=postgres://user:pass@localhost:5432/hello_test npm run test:postgres`. Use a separate,
empty database. Each test file creates its own schema (`t_<pid>_<n>_<hex>`) and drops it afterwards; the suite never
touches `public` and refuses to run when the URL equals `DATABASE_URL`. Without the variable, `npm run test:postgres`
exits with a message and the Postgres-only tests are skipped in `npx vitest run`.
