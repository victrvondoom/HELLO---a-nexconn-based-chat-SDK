-- Database behaviour tests for migration 0001.
-- Run against a database that has the migration applied and the Supabase stubs
-- (auth.users, auth.uid()). Every check runs inside one transaction that is rolled back.
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/0001_constraints_and_rls.sql
-- A failed check raises an exception and stops the script.

begin;

-- Fixture rows, inserted as the owner so RLS does not interfere.
insert into auth.users (id) values
  ('00000000-0000-0000-0000-00000000000a'), -- attendee A (member of event 1)
  ('00000000-0000-0000-0000-00000000000b'), -- attendee B (member of event 1)
  ('00000000-0000-0000-0000-00000000000c'), -- organiser (event 1)
  ('00000000-0000-0000-0000-00000000000d'); -- stranger (member of nothing)

insert into profiles (id, display_name) values
  ('00000000-0000-0000-0000-00000000000a', 'Attendee A'),
  ('00000000-0000-0000-0000-00000000000b', 'Attendee B'),
  ('00000000-0000-0000-0000-00000000000c', 'Organiser C'),
  ('00000000-0000-0000-0000-00000000000d', 'Stranger D');

insert into events (id, name, is_demo) values
  ('10000000-0000-0000-0000-000000000001', 'Event One', true),
  ('10000000-0000-0000-0000-000000000002', 'Event Two', false);

insert into memberships (event_id, user_id, role) values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', 'ATTENDEE'),
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000b', 'ATTENDEE'),
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000c', 'ORGANISER');

insert into rooms (id, event_id, name, zone, capacity) values
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Room 3', 'Workshop', 40),
  ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', 'Other Room', 'Main', 40);

insert into incidents (id, event_id, category, status, title, room_id, created_by_user_id)
values ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'AV', 'TRIAGED',
        'Microphone fault in Room 3', '20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a');

insert into incident_reports (incident_id, event_id, reporter_user_id, body, match_confidence)
values ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001',
        '00000000-0000-0000-0000-00000000000a', 'Mic crackling', 1);

-- 1. Occupancy must carry a source.
do $$
begin
  begin
    insert into rooms (event_id, name, zone, capacity, occupancy)
    values ('10000000-0000-0000-0000-000000000001', 'No Source', 'Main', 10, 5);
    raise exception 'FAIL: occupancy without a source was accepted';
  exception when check_violation then null;
  end;
end $$;

-- 2. A resolved incident must carry a resolution note.
do $$
begin
  begin
    update incidents set status = 'RESOLVED' where id = '30000000-0000-0000-0000-000000000001';
    raise exception 'FAIL: RESOLVED without resolution_note was accepted';
  exception when check_violation then null;
  end;
end $$;

-- 3. Four-eyes: the requester cannot be the decider.
do $$
begin
  begin
    insert into approval_requests (event_id, action_type, payload, justification, requested_by_user_id,
                                   status, decided_at, decided_by_user_id, expires_at)
    values ('10000000-0000-0000-0000-000000000001', 'PUBLISH_ANNOUNCEMENT', '{"title":"x"}', 'self',
            '00000000-0000-0000-0000-00000000000c', 'APPROVED', now(),
            '00000000-0000-0000-0000-00000000000c', now() + interval '1 hour');
    raise exception 'FAIL: self-approval was accepted';
  exception when check_violation then null;
  end;
end $$;

-- 4. Only one pending request may exist per event, action and payload.
insert into approval_requests (event_id, action_type, payload, justification, requested_by_user_id, expires_at)
values ('10000000-0000-0000-0000-000000000001', 'MOVE_SESSION_ROOM', '{"sessionId":"s1","toRoomId":"r1"}',
        'move', null, now() + interval '1 hour');
do $$
begin
  begin
    insert into approval_requests (event_id, action_type, payload, justification, requested_by_user_id, expires_at)
    values ('10000000-0000-0000-0000-000000000001', 'MOVE_SESSION_ROOM', '{"sessionId":"s1","toRoomId":"r1"}',
            'duplicate', null, now() + interval '1 hour');
    raise exception 'FAIL: duplicate pending approval was accepted';
  exception when unique_violation then null;
  end;
end $$;

-- 5. Audit rows cannot be changed.
insert into audit_logs (event_id, actor_user_id, action, target_type, target_id)
values ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000c', 'test', 'incident', 'x');
do $$
begin
  begin
    update audit_logs set action = 'tampered';
    raise exception 'FAIL: audit row was updated';
  exception when others then
    if sqlerrm not like '%append-only%' then raise; end if;
  end;
end $$;

-- 6. Row level security. Each check runs as the authenticated role with a JWT subject.
-- Supabase grants these to `authenticated` by default. The grants are repeated here so the
-- test also runs on a plain PostgreSQL database. They are rolled back with the rest of the transaction.
grant usage on schema public, auth to authenticated;
grant select on all tables in schema public to authenticated;
grant execute on all functions in schema public to authenticated;
grant execute on function auth.uid() to authenticated;
set local role authenticated;

-- 6a. A stranger sees no event data at all.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000d', true);
do $$
begin
  if (select count(*) from rooms) <> 0 then raise exception 'FAIL: stranger can read rooms'; end if;
  if (select count(*) from incidents) <> 0 then raise exception 'FAIL: stranger can read incidents'; end if;
  if (select count(*) from events) <> 0 then raise exception 'FAIL: stranger can read events'; end if;
end $$;

-- 6b. Attendee B cannot read attendee A's incident report, and sees no incident they did not report.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', true);
do $$
begin
  if (select count(*) from incidents) <> 0 then raise exception 'FAIL: attendee B can read another attendee''s incident'; end if;
  if (select count(*) from incident_reports) <> 0 then raise exception 'FAIL: attendee B can read another attendee''s report'; end if;
end $$;

-- 6c. Attendee A (the reporter) sees their incident.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
do $$
begin
  if (select count(*) from incidents) <> 1 then raise exception 'FAIL: reporter cannot see their own incident'; end if;
end $$;

-- 6d. The organiser sees event rooms, but not rooms from another event.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000c', true);
do $$
begin
  if (select count(*) from rooms) <> 1 then raise exception 'FAIL: organiser sees rooms from another event'; end if;
  if (select count(*) from approval_requests) <> 1 then raise exception 'FAIL: organiser cannot see pending approval'; end if;
end $$;

reset role;
rollback;

select 'ALL DATABASE CHECKS PASSED' as result;
