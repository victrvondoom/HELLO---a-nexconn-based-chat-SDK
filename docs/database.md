# Database

## Status

| Piece | Status |
|---|---|
| `supabase/migrations/0001_core_schema.sql` | Written. Applied to a fresh PostgreSQL 16 database and verified (see below). |
| `supabase/tests/0001_constraints_and_rls.sql` | Written and passing: constraint, append-only audit and RLS checks. |
| `supabase/seed.sql` | Written and applied. Event, rooms and sessions only. |
| Postgres-backed `HelloStore` | **Not written.** The app runs on `MemoryHelloStore`, which is not durable. |
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
