-- =============================================================================
-- HELLO core schema — migration 0001
-- Target: PostgreSQL 15+ (Supabase). Applies to an empty database.
--
-- Design rules used throughout:
--   * Operational state lives in typed columns with CHECK constraints or enums.
--     JSONB is used only for the message interpretation and approval payloads,
--     both of which are validated by the application before they are written.
--   * Every write that changes an incident or approval is guarded by `version`
--     (optimistic concurrency), mirrored by the application's VERSION_CONFLICT rule.
--   * Row Level Security is enabled on every table. Server code uses the service
--     role, which bypasses RLS; RLS is the second line of defence for any direct
--     client access (see docs/security.md).
--   * Demo rows are flagged (`events.is_demo`, `rooms.occupancy_source = 'DEMO_SEED'`).
-- =============================================================================

-- ---------- enums ------------------------------------------------------------

create type role_code as enum (
  'ATTENDEE', 'SPEAKER', 'VOLUNTEER', 'OPERATIONS_STAFF', 'ORGANISER', 'PLATFORM_ADMIN'
);

create type incident_category as enum (
  'AV', 'CAPACITY', 'ACCESSIBILITY', 'FACILITIES', 'SCHEDULE', 'GENERAL'
);

create type incident_status as enum (
  'REPORTED', 'TRIAGED', 'ASSIGNED', 'ACKNOWLEDGED', 'IN_PROGRESS', 'RESOLVED',
  'CONFIRMED', 'CLOSED', 'REOPENED', 'CANCELLED', 'NEEDS_INFORMATION', 'ESCALATED'
);

create type urgency_level as enum ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

create type data_source as enum ('LIVE_VERIFIED', 'ADMIN_ENTERED', 'REPORTED_BY_ATTENDEES', 'DEMO_SEED');

create type availability_state as enum ('AVAILABLE', 'BUSY', 'OFF_SHIFT');

create type approval_status as enum ('PENDING', 'APPROVED', 'REJECTED', 'EXPIRED');

create type execution_status as enum ('NOT_STARTED', 'SUCCEEDED', 'FAILED');

create type consequential_action as enum (
  'MOVE_SESSION_ROOM', 'PUBLISH_ANNOUNCEMENT', 'CANCEL_SESSION', 'REASSIGN_STAFF'
);

create type signal_review_status as enum ('PENDING_REVIEW', 'ACCEPTED', 'REJECTED');

create type timeline_entry_type as enum (
  'CREATED', 'REPORT_ATTACHED', 'STATUS_CHANGED', 'ASSIGNED',
  'ASSIGNMENT_RECOMMENDED', 'NOTE', 'APPROVAL_REQUESTED'
);

-- ---------- shared trigger: keep updated_at honest ---------------------------

create or replace function hello_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------- identity ---------------------------------------------------------

-- Profiles mirror Supabase Auth users. The FK requires the auth schema (Supabase provides it).
create table profiles (
  id                     uuid primary key references auth.users (id) on delete cascade,
  display_name           text not null check (char_length(display_name) between 1 and 80),
  discoverable           boolean not null default false,
  accessibility_required boolean not null default false,
  interests              text[] not null default '{}' check (cardinality(interests) <= 25),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
create trigger profiles_touch before update on profiles
  for each row execute function hello_touch_updated_at();

-- ---------- events & membership ---------------------------------------------

create table events (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(name) between 1 and 160),
  timezone    text not null default 'UTC',
  is_demo     boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger events_touch before update on events
  for each row execute function hello_touch_updated_at();

-- One membership per user per event. A role is never inferred from anywhere else.
create table memberships (
  id           uuid primary key default gen_random_uuid(),
  event_id     uuid not null references events (id) on delete cascade,
  user_id      uuid not null references profiles (id) on delete cascade,
  role         role_code not null,
  skills       text[] not null default '{}',
  availability availability_state not null default 'AVAILABLE',
  zone         text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (event_id, user_id)
);
create index memberships_user_idx on memberships (user_id);
create index memberships_event_role_idx on memberships (event_id, role);
create trigger memberships_touch before update on memberships
  for each row execute function hello_touch_updated_at();

-- ---------- event structure ---------------------------------------------------

create table rooms (
  id                uuid primary key default gen_random_uuid(),
  event_id          uuid not null references events (id) on delete cascade,
  name              text not null check (char_length(name) between 1 and 80),
  zone              text not null,
  capacity          integer not null check (capacity > 0),
  accessible        boolean not null default false,
  equipment         text[] not null default '{}',
  occupancy         integer check (occupancy is null or occupancy >= 0),
  occupancy_source  data_source,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (event_id, name),
  -- A figure must always say where it came from.
  constraint rooms_occupancy_has_source check ((occupancy is null) = (occupancy_source is null))
);
create index rooms_event_idx on rooms (event_id);
create trigger rooms_touch before update on rooms
  for each row execute function hello_touch_updated_at();

create table sessions (
  id               uuid primary key default gen_random_uuid(),
  event_id         uuid not null references events (id) on delete cascade,
  title            text not null check (char_length(title) between 1 and 160),
  topics           text[] not null default '{}',
  room_id          uuid not null references rooms (id) on delete restrict,
  starts_at        timestamptz not null,
  ends_at          timestamptz not null,
  capacity         integer not null check (capacity > 0),
  enrolled         integer not null default 0 check (enrolled >= 0),
  accessible       boolean not null default false,
  speaker_user_id  uuid references profiles (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint sessions_time_order check (ends_at > starts_at)
);
create index sessions_event_time_idx on sessions (event_id, starts_at);
create index sessions_room_time_idx on sessions (room_id, starts_at, ends_at);
create trigger sessions_touch before update on sessions
  for each row execute function hello_touch_updated_at();

create table announcements (
  id                    uuid primary key default gen_random_uuid(),
  event_id              uuid not null references events (id) on delete cascade,
  title                 text not null check (char_length(title) between 1 and 160),
  body                  text not null check (char_length(body) between 1 and 4000),
  published_by_user_id  uuid references profiles (id) on delete set null,
  published_at          timestamptz not null default now()
);
create index announcements_event_idx on announcements (event_id, published_at desc);

-- ---------- conversation -----------------------------------------------------

create table messages (
  id                  uuid primary key default gen_random_uuid(),
  event_id            uuid not null references events (id) on delete cascade,
  sender_user_id      uuid not null references profiles (id) on delete cascade,
  body                text not null check (char_length(body) between 1 and 2000),
  -- Structured interpretation. Validated by the application against its schema before insert.
  interpretation      jsonb,
  linked_incident_id  uuid,
  linked_approval_id  uuid,
  created_at          timestamptz not null default now()
);
create index messages_event_time_idx on messages (event_id, created_at);
create index messages_sender_idx on messages (sender_user_id);

-- ---------- incidents --------------------------------------------------------

create table incidents (
  id                 uuid primary key default gen_random_uuid(),
  event_id           uuid not null references events (id) on delete cascade,
  category           incident_category not null,
  status             incident_status not null,
  urgency            urgency_level not null default 'MEDIUM',
  title              text not null check (char_length(title) between 1 and 160),
  room_id            uuid references rooms (id) on delete set null,
  session_id         uuid references sessions (id) on delete set null,
  equipment          text[] not null default '{}',
  created_by_user_id uuid not null references profiles (id) on delete restrict,
  assignee_user_id   uuid references profiles (id) on delete set null,
  version            integer not null default 1 check (version >= 1),
  acknowledged_at    timestamptz,
  resolved_at        timestamptz,
  confirmed_at       timestamptz,
  resolution_note    text check (resolution_note is null or char_length(resolution_note) <= 1000),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  -- A resolved incident must say what was done.
  constraint incidents_resolution_needs_note check (
    status not in ('RESOLVED', 'CONFIRMED', 'CLOSED') or resolution_note is not null
  )
);
create index incidents_event_status_idx on incidents (event_id, status);
create index incidents_event_room_category_idx on incidents (event_id, room_id, category);
create index incidents_assignee_open_idx on incidents (assignee_user_id)
  where status not in ('CLOSED', 'CANCELLED', 'CONFIRMED');
create trigger incidents_touch before update on incidents
  for each row execute function hello_touch_updated_at();

-- Each person's report is kept, even when it is attached to an existing incident.
create table incident_reports (
  id                uuid primary key default gen_random_uuid(),
  incident_id       uuid not null references incidents (id) on delete cascade,
  event_id          uuid not null references events (id) on delete cascade,
  reporter_user_id  uuid not null references profiles (id) on delete cascade,
  body              text not null check (char_length(body) between 1 and 2000),
  match_confidence  numeric(4, 3) not null check (match_confidence between 0 and 1),
  match_signals     text[] not null default '{}',
  created_at        timestamptz not null default now()
);
create index incident_reports_incident_idx on incident_reports (incident_id);
create index incident_reports_event_time_idx on incident_reports (event_id, created_at);
create index incident_reports_reporter_idx on incident_reports (reporter_user_id);

create table incident_timeline (
  id           uuid primary key default gen_random_uuid(),
  incident_id  uuid not null references incidents (id) on delete cascade,
  event_id     uuid not null references events (id) on delete cascade,
  entry_type   timeline_entry_type not null,
  actor_user_id uuid references profiles (id) on delete set null,
  from_status  incident_status,
  to_status    incident_status,
  detail       text not null check (char_length(detail) <= 1000),
  at           timestamptz not null default now()
);
create index incident_timeline_incident_idx on incident_timeline (incident_id, at);

-- ---------- approvals --------------------------------------------------------

create table approval_requests (
  id                  uuid primary key default gen_random_uuid(),
  event_id            uuid not null references events (id) on delete cascade,
  action_type         consequential_action not null,
  payload             jsonb not null check (jsonb_typeof(payload) = 'object'),
  justification       text not null check (char_length(justification) between 1 and 1000),
  -- NULL when the request was raised by HELLO's own coordination logic.
  requested_by_user_id uuid references profiles (id) on delete set null,
  status              approval_status not null default 'PENDING',
  expires_at          timestamptz not null,
  decided_by_user_id  uuid references profiles (id) on delete set null,
  decided_at          timestamptz,
  decision_reason     text check (decision_reason is null or char_length(decision_reason) <= 500),
  -- Approval and execution are separate facts.
  execution_status    execution_status not null default 'NOT_STARTED',
  execution_result    text,
  executed_at         timestamptz,
  linked_incident_id  uuid references incidents (id) on delete set null,
  version             integer not null default 0 check (version >= 0),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint approvals_decided_fields check (
    (status = 'PENDING') or (decided_at is not null)
  ),
  constraint approvals_execution_requires_approval check (
    execution_status = 'NOT_STARTED' or status = 'APPROVED'
  ),
  constraint approvals_four_eyes check (
    decided_by_user_id is null or requested_by_user_id is null or decided_by_user_id <> requested_by_user_id
  )
);
create index approvals_event_status_idx on approval_requests (event_id, status);
-- The same pending request can never be queued twice for one event.
create unique index approvals_one_pending_per_payload on approval_requests (
  event_id, action_type, md5(payload::text)
) where status = 'PENDING';
create trigger approvals_touch before update on approval_requests
  for each row execute function hello_touch_updated_at();

-- ---------- notifications, audit, signals -----------------------------------

create table notifications (
  id                 uuid primary key default gen_random_uuid(),
  event_id           uuid not null references events (id) on delete cascade,
  recipient_user_id  uuid not null references profiles (id) on delete cascade,
  kind               text not null check (char_length(kind) between 1 and 60),
  body               text not null check (char_length(body) between 1 and 1000),
  href               text not null check (href like '/%'),
  dedupe_key         text not null,
  created_at         timestamptz not null default now(),
  -- Writing the same key twice is a no-op at the database level.
  unique (event_id, dedupe_key)
);
create index notifications_recipient_idx on notifications (recipient_user_id, created_at desc);

create table audit_logs (
  id             uuid primary key default gen_random_uuid(),
  event_id       uuid references events (id) on delete cascade,
  actor_user_id  uuid references profiles (id) on delete set null,
  action         text not null check (char_length(action) between 1 and 80),
  target_type    text not null,
  target_id      text not null,
  detail         text not null default '',
  at             timestamptz not null default now()
);
create index audit_logs_event_time_idx on audit_logs (event_id, at);

-- Audit rows are append-only: updates and deletes are rejected.
create or replace function hello_audit_append_only()
returns trigger
language plpgsql
as $$
begin
  raise exception 'audit_logs is append-only';
end;
$$;
create trigger audit_logs_no_update before update or delete on audit_logs
  for each row execute function hello_audit_append_only();

create table signal_patterns (
  id                  text primary key,
  event_id            uuid not null references events (id) on delete cascade,
  room_id             uuid references rooms (id) on delete set null,
  category            incident_category not null,
  window_start        timestamptz not null,
  window_end          timestamptz not null,
  distinct_reporters  integer not null check (distinct_reporters >= 2),
  report_ids          uuid[] not null,
  incident_ids        uuid[] not null,
  confidence          numeric(4, 3) not null check (confidence >= 0 and confidence < 1),
  explanation         text not null,
  recommendation      text not null,
  review_status       signal_review_status not null default 'PENDING_REVIEW',
  reviewed_by_user_id uuid references profiles (id) on delete set null,
  reviewed_at         timestamptz,
  created_at          timestamptz not null default now(),
  constraint signal_review_fields check (
    review_status = 'PENDING_REVIEW' or reviewed_at is not null
  )
);
create index signal_patterns_event_idx on signal_patterns (event_id, review_status);

-- ---------- row level security -----------------------------------------------

-- Helper: the caller's role in an event, or NULL. SECURITY DEFINER avoids recursive policy checks.
create or replace function hello_event_role(p_event uuid)
returns role_code
language sql
stable
security definer
set search_path = public
as $$
  select m.role from memberships m
  where m.event_id = p_event and m.user_id = auth.uid()
  limit 1;
$$;

create or replace function hello_is_member(p_event uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from memberships m where m.event_id = p_event and m.user_id = auth.uid()
  );
$$;

create or replace function hello_is_operational(p_event uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(hello_event_role(p_event) in ('VOLUNTEER', 'OPERATIONS_STAFF', 'ORGANISER'), false);
$$;

alter table profiles enable row level security;
alter table events enable row level security;
alter table memberships enable row level security;
alter table rooms enable row level security;
alter table sessions enable row level security;
alter table announcements enable row level security;
alter table messages enable row level security;
alter table incidents enable row level security;
alter table incident_reports enable row level security;
alter table incident_timeline enable row level security;
alter table approval_requests enable row level security;
alter table notifications enable row level security;
alter table audit_logs enable row level security;
alter table signal_patterns enable row level security;

-- Profiles: you see your own profile, and discoverable profiles of people in your events.
create policy profiles_read_own on profiles for select
  using (id = auth.uid());
create policy profiles_read_discoverable on profiles for select
  using (
    discoverable
    and exists (
      select 1 from memberships mine
      join memberships theirs on theirs.event_id = mine.event_id
      where mine.user_id = auth.uid() and theirs.user_id = profiles.id
    )
  );
create policy profiles_update_own on profiles for update
  using (id = auth.uid()) with check (id = auth.uid());

-- Event-scoped reads: members only. Nothing is readable across events.
create policy events_member_read on events for select using (hello_is_member(id));
create policy memberships_member_read on memberships for select using (hello_is_member(event_id));
create policy rooms_member_read on rooms for select using (hello_is_member(event_id));
create policy sessions_member_read on sessions for select using (hello_is_member(event_id));
create policy announcements_member_read on announcements for select using (hello_is_member(event_id));

-- Messages: attendees see their own; operational staff and organisers see the event conversation.
create policy messages_read on messages for select using (
  sender_user_id = auth.uid()
  or hello_is_operational(event_id)
);

-- Incidents: reporters see their own; operational staff see everything in their event.
create policy incidents_read on incidents for select using (
  hello_is_operational(event_id)
  or created_by_user_id = auth.uid()
  or exists (
    select 1 from incident_reports r
    where r.incident_id = incidents.id and r.reporter_user_id = auth.uid()
  )
);
create policy incident_reports_read on incident_reports for select using (
  hello_is_operational(event_id) or reporter_user_id = auth.uid()
);
create policy incident_timeline_read on incident_timeline for select using (
  hello_is_operational(event_id)
  or exists (
    select 1 from incidents i
    where i.id = incident_timeline.incident_id
      and (i.created_by_user_id = auth.uid()
           or exists (select 1 from incident_reports r where r.incident_id = i.id and r.reporter_user_id = auth.uid()))
  )
);

-- Approvals: organisers see all for their event; the requester sees their own.
create policy approvals_read on approval_requests for select using (
  hello_event_role(event_id) = 'ORGANISER'
  or requested_by_user_id = auth.uid()
);

-- Signals: operational staff and organisers only.
create policy signal_patterns_read on signal_patterns for select using (hello_is_operational(event_id));

-- Notifications: recipients only.
create policy notifications_recipient_read on notifications for select using (recipient_user_id = auth.uid());

-- Audit: organisers of the event.
create policy audit_organiser_read on audit_logs for select using (
  event_id is not null and hello_event_role(event_id) = 'ORGANISER'
);

-- No direct client INSERT/UPDATE/DELETE policies are created for the domain tables.
-- Every state change is made by server code under its permission checks, using the service role.
