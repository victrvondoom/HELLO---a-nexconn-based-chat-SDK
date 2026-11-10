-- =============================================================================
-- DEMO SEED — HELLO Global Technology Summit
-- Every row here is fictional and labelled as demo data (events.is_demo = true,
-- rooms.occupancy_source = 'DEMO_SEED'). It is not real event information.
--
-- Scope: the event, its rooms and sessions. People (profiles and memberships)
-- depend on Supabase Auth accounts, which must be created first. The in-memory
-- demo in this build provides them; see docs/database.md for the remaining step.
-- =============================================================================

insert into events (id, name, timezone, is_demo) values
  ('e0000000-0000-4000-8000-000000000001', 'HELLO Global Technology Summit', 'UTC', true)
on conflict (id) do nothing;

insert into rooms (id, event_id, name, zone, capacity, accessible, equipment, occupancy, occupancy_source) values
  ('a0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000001', 'Main Hall', 'Main',     300, true,  '{microphone,projector,screen}', 210, 'DEMO_SEED'),
  ('a0000000-0000-4000-8000-000000000002', 'e0000000-0000-4000-8000-000000000001', 'Room 2',    'Workshop', 60,  false, '{projector}',                    18, 'DEMO_SEED'),
  ('a0000000-0000-4000-8000-000000000003', 'e0000000-0000-4000-8000-000000000001', 'Room 3',    'Workshop', 40,  true,  '{microphone,projector}',         52, 'DEMO_SEED'),
  ('a0000000-0000-4000-8000-000000000004', 'e0000000-0000-4000-8000-000000000001', 'Room 4',    'Main',     80,  true,  '{microphone,screen}',          null, null)
on conflict (id) do nothing;

insert into sessions (id, event_id, title, topics, room_id, starts_at, ends_at, capacity, enrolled, accessible) values
  ('b0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000001', 'Keynote: Coordinating Physical Events', '{events,coordination}', 'a0000000-0000-4000-8000-000000000001', '2026-11-10 09:00+00', '2026-11-10 10:00+00', 300, 280, true),
  ('b0000000-0000-4000-8000-000000000002', 'e0000000-0000-4000-8000-000000000001', 'Satellite Power Systems', '{satellite power,space engineering}', 'a0000000-0000-4000-8000-000000000003', '2026-11-10 13:00+00', '2026-11-10 14:00+00', 40, 40, true),
  ('b0000000-0000-4000-8000-000000000003', 'e0000000-0000-4000-8000-000000000001', 'Robotics in Practice', '{robotics,automation}', 'a0000000-0000-4000-8000-000000000001', '2026-11-10 13:00+00', '2026-11-10 14:00+00', 300, 210, true),
  ('b0000000-0000-4000-8000-000000000004', 'e0000000-0000-4000-8000-000000000001', 'Zero Trust for Event Networks', '{cybersecurity,zero trust}', 'a0000000-0000-4000-8000-000000000002', '2026-11-10 14:00+00', '2026-11-10 15:00+00', 60, 20, false),
  ('b0000000-0000-4000-8000-000000000005', 'e0000000-0000-4000-8000-000000000001', 'Edge Computing at Scale', '{edge computing}', 'a0000000-0000-4000-8000-000000000004', '2026-11-10 14:00+00', '2026-11-10 15:00+00', 80, 30, true),
  ('b0000000-0000-4000-8000-000000000006', 'e0000000-0000-4000-8000-000000000001', 'Satellite Communication Networks', '{satellite communication,satellite power systems}', 'a0000000-0000-4000-8000-000000000001', '2026-11-10 15:00+00', '2026-11-10 16:00+00', 300, 90, true)
on conflict (id) do nothing;
