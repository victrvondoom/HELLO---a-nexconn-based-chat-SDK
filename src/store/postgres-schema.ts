/**
 * The Postgres schema behind `PostgresHelloStore` (src/store/postgres.ts).
 *
 * Shape: one table per kind of record the `HelloStore` contract holds. Each table has the columns the store
 * queries and indexes on (event, user, version, dedupe key) and the whole record in `data jsonb`, so a record
 * comes back exactly as it was written, the same as from the in-memory store. `seq` keeps insertion order,
 * which the in-memory store also preserves and which several lists rely on.
 *
 * Rules the database itself enforces:
 * - one notification per (event, dedupe key), one follow per pair, one document per (collection, id);
 * - version-checked rows (incidents, approvals, payments) carry their version in a column;
 * - nothing is deleted by cascade: erasure is an explicit, audited service operation.
 *
 * Every statement is idempotent, so the store can apply it at start-up under an advisory lock, and several
 * instances can start at once. `supabase/migrations/0001_core_schema.sql` is the separate relational design for
 * a Supabase Auth deployment; see docs/database.md.
 */
export const SCHEMA_VERSION = 1;

export const SCHEMA_SQL = `
create table if not exists hello_meta (
  key text primary key,
  value jsonb not null
);

create table if not exists hello_events (id text primary key, seq bigserial, data jsonb not null);
create table if not exists hello_users (id text primary key, seq bigserial, data jsonb not null);

create table if not exists hello_memberships (
  id text primary key, seq bigserial,
  event_id text not null, user_id text not null,
  data jsonb not null
);
create index if not exists hello_memberships_event on hello_memberships (event_id, seq);
create index if not exists hello_memberships_user on hello_memberships (user_id, seq);

create table if not exists hello_rooms (id text primary key, seq bigserial, event_id text not null, data jsonb not null);
create index if not exists hello_rooms_event on hello_rooms (event_id, seq);

create table if not exists hello_sessions (id text primary key, seq bigserial, event_id text not null, data jsonb not null);
create index if not exists hello_sessions_event on hello_sessions (event_id, seq);

create table if not exists hello_messages (
  id text primary key, seq bigserial,
  event_id text not null, sender_user_id text not null,
  data jsonb not null
);
create index if not exists hello_messages_event on hello_messages (event_id, seq);
create index if not exists hello_messages_sender on hello_messages (sender_user_id);

create table if not exists hello_incidents (
  id text primary key, seq bigserial,
  event_id text not null, version integer not null,
  data jsonb not null
);
create index if not exists hello_incidents_event on hello_incidents (event_id, seq);

create table if not exists hello_reports (
  id text primary key, seq bigserial,
  event_id text not null, incident_id text not null, reporter_user_id text not null,
  data jsonb not null
);
create index if not exists hello_reports_event on hello_reports (event_id, seq);
create index if not exists hello_reports_incident on hello_reports (incident_id, seq);
create index if not exists hello_reports_reporter on hello_reports (reporter_user_id);

create table if not exists hello_timeline (id text primary key, seq bigserial, incident_id text not null, data jsonb not null);
create index if not exists hello_timeline_incident on hello_timeline (incident_id, seq);

create table if not exists hello_approvals (
  id text primary key, seq bigserial,
  event_id text not null, version integer not null,
  data jsonb not null
);
create index if not exists hello_approvals_event on hello_approvals (event_id, seq);

create table if not exists hello_announcements (id text primary key, seq bigserial, event_id text not null, data jsonb not null);
create index if not exists hello_announcements_event on hello_announcements (event_id, seq);

create table if not exists hello_audit (id text primary key, seq bigserial, event_id text not null, data jsonb not null);
create index if not exists hello_audit_event on hello_audit (event_id, seq);

create table if not exists hello_notifications (
  id text primary key, seq bigserial,
  event_id text not null, recipient_user_id text not null, dedupe_key text not null,
  data jsonb not null,
  unique (event_id, dedupe_key)
);
create index if not exists hello_notifications_recipient on hello_notifications (recipient_user_id, seq);

create table if not exists hello_signal_patterns (id text primary key, seq bigserial, event_id text not null, data jsonb not null);
create index if not exists hello_signal_patterns_event on hello_signal_patterns (event_id, seq);

create table if not exists hello_reference_docs (id text primary key, seq bigserial, event_id text not null, data jsonb not null);
create index if not exists hello_reference_docs_event on hello_reference_docs (event_id, seq);

create table if not exists hello_venues (event_id text primary key, seq bigserial, data jsonb not null);
create table if not exists hello_profiles (user_id text primary key, seq bigserial, data jsonb not null);

create table if not exists hello_follows (
  follower_id text not null, followee_id text not null, seq bigserial,
  data jsonb not null,
  primary key (follower_id, followee_id)
);
create index if not exists hello_follows_followee on hello_follows (followee_id, seq);

create table if not exists hello_key_bundles (id text primary key, seq bigserial, user_id text not null, data jsonb not null);
create index if not exists hello_key_bundles_user on hello_key_bundles (user_id, seq);

create table if not exists hello_sealed (
  id text primary key, seq bigserial,
  sender_id text not null, recipient_id text not null,
  data jsonb not null
);
create index if not exists hello_sealed_sender on hello_sealed (sender_id, seq);
create index if not exists hello_sealed_recipient on hello_sealed (recipient_id, seq);

create table if not exists hello_payments (
  id text primary key, seq bigserial,
  payer_id text not null, payee_id text not null, version integer not null,
  data jsonb not null
);
create index if not exists hello_payments_payer on hello_payments (payer_id, seq);
create index if not exists hello_payments_payee on hello_payments (payee_id, seq);

create table if not exists hello_documents (
  collection text not null, id text not null, seq bigserial,
  data jsonb not null,
  primary key (collection, id)
);
create index if not exists hello_documents_event on hello_documents (collection, (data->>'eventId'), seq);
create index if not exists hello_documents_data on hello_documents using gin (data jsonb_path_ops);

create table if not exists hello_blobs (id text primary key, bytes bytea not null);

insert into hello_meta (key, value) values ('schema_version', '${SCHEMA_VERSION}'::jsonb)
  on conflict (key) do nothing;
`;

/** Every table, for a demo reset (truncate) and for dropping a test schema. */
export const TABLES = [
  'hello_meta',
  'hello_events',
  'hello_users',
  'hello_memberships',
  'hello_rooms',
  'hello_sessions',
  'hello_messages',
  'hello_incidents',
  'hello_reports',
  'hello_timeline',
  'hello_approvals',
  'hello_announcements',
  'hello_audit',
  'hello_notifications',
  'hello_signal_patterns',
  'hello_reference_docs',
  'hello_venues',
  'hello_profiles',
  'hello_follows',
  'hello_key_bundles',
  'hello_sealed',
  'hello_payments',
  'hello_documents',
  'hello_blobs',
] as const;
