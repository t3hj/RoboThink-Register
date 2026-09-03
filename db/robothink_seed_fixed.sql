-- Seed data for RoboThink with explicit UUIDs (ready to run)

-- Levels (ids 1/2/3 already in schema)

-- Profiles / instructors (fixed UUIDs)
INSERT INTO profiles (id, name, email, role) VALUES
  ('11111111-1111-1111-1111-111111111111','Dan Reeves','dan@example.com','admin') ON CONFLICT DO NOTHING,
  ('22222222-2222-2222-2222-222222222222','Priya Nair','priya@example.com','instructor') ON CONFLICT DO NOTHING,
  ('33333333-3333-3333-3333-333333333333','Sam Okoye','sam@example.com','instructor') ON CONFLICT DO NOTHING;

-- Subscriptions (ensure ids)
-- Find subscription ids if different; assume 1=Elite, 2=Term Time

-- Students with fixed UUIDs
INSERT INTO students (id, full_name, preferred_day, preferred_time, subscription_id, current_level_id, date_joined, parent_name, parent_contact, notes, active)
VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001','Alex Patel','Tuesday','16:00',1,2,'2025-09-02','Nina Patel','07700 900111','',true),
  ('aaaaaaaa-0000-0000-0000-000000000002','Sara Khan','Tuesday','17:00',2,1,'2026-01-12','Imran Khan','07700 900222','',true),
  ('aaaaaaaa-0000-0000-0000-000000000003','Jay Thompson','Tuesday','18:00',1,3,'2025-11-20','Claire Thompson','07700 900333','',true),
  ('aaaaaaaa-0000-0000-0000-000000000004','Mia Chen','Monday','16:30',1,2,'2025-10-06','Wei Chen','07700 900444','Prefers front bench.',true),
  ('aaaaaaaa-0000-0000-0000-000000000005','Leo Bianchi','Wednesday','16:00',2,1,'2026-02-18','Sofia Bianchi','07700 900555','',true),
  ('aaaaaaaa-0000-0000-0000-000000000006','Zara Ahmed','Thursday','17:30',2,3,'2025-09-15','Farida Ahmed','07700 900666','',true),
  ('aaaaaaaa-0000-0000-0000-000000000007','Oli Marsh','Tuesday','16:00',2,2,'2025-09-02','Ben Marsh','07700 900777','',true),
  ('aaaaaaaa-0000-0000-0000-000000000008','Ruby Sinclair','Tuesday','17:00',1,1,'2026-03-01','Kate Sinclair','07700 900888','',true),
  ('aaaaaaaa-0000-0000-0000-000000000009','Finn Osei','Tuesday','18:00',1,3,'2025-08-20','Ama Osei','07700 900999','Transferred from another centre; progress hand-set by admin.',true)
ON CONFLICT DO NOTHING;

-- Lesson records: provide sample completed lessons
-- Alex: lessons 1-5 completed
INSERT INTO lesson_records (id, student_id, level_id, lesson_number, date, instructor_id, status)
VALUES
  (gen_random_uuid(),'aaaaaaaa-0000-0000-0000-000000000001',2,1,'2026-07-21','22222222-2222-2222-2222-222222222222','completed'),
  (gen_random_uuid(),'aaaaaaaa-0000-0000-0000-000000000001',2,2,'2026-07-28','22222222-2222-2222-2222-222222222222','completed'),
  (gen_random_uuid(),'aaaaaaaa-0000-0000-0000-000000000001',2,3,'2026-08-04','22222222-2222-2222-2222-222222222222','completed'),
  (gen_random_uuid(),'aaaaaaaa-0000-0000-0000-000000000001',2,4,'2026-08-11','22222222-2222-2222-2222-222222222222','completed'),
  (gen_random_uuid(),'aaaaaaaa-0000-0000-0000-000000000001',2,5,'2026-08-18','22222222-2222-2222-2222-222222222222','completed')
ON CONFLICT DO NOTHING;

-- Sara: lessons 1-3
INSERT INTO lesson_records (id, student_id, level_id, lesson_number, date, instructor_id, status)
VALUES
  (gen_random_uuid(),'aaaaaaaa-0000-0000-0000-000000000002',1,1,'2026-08-04','22222222-2222-2222-2222-222222222222','completed'),
  (gen_random_uuid(),'aaaaaaaa-0000-0000-0000-000000000002',1,2,'2026-08-11','22222222-2222-2222-2222-222222222222','completed'),
  (gen_random_uuid(),'aaaaaaaa-0000-0000-0000-000000000002',1,3,'2026-08-18','22222222-2222-2222-2222-222222222222','completed')
ON CONFLICT DO NOTHING;

-- Jay: lessons 1-8
DO $$
BEGIN
  FOR i IN 1..8 LOOP
    INSERT INTO lesson_records (id, student_id, level_id, lesson_number, date, instructor_id, status)
    VALUES (gen_random_uuid(),'aaaaaaaa-0000-0000-0000-000000000003',3,i,('2026-06-' || LPAD((i%4)+1::text,2,'0'))::date, CASE WHEN i%2=1 THEN '33333333-3333-3333-3333-333333333333' ELSE '22222222-2222-2222-2222-222222222222' END,'completed')
    ON CONFLICT DO NOTHING;
  END LOOP;
END $$;

-- Mia: lessons 1-5 with 5 as catch-up on a Wednesday (attendance will reflect catch_up=true)
DO $$
BEGIN
  FOR i IN 1..4 LOOP
    INSERT INTO lesson_records (id, student_id, level_id, lesson_number, date, instructor_id, status)
    VALUES (gen_random_uuid(),'aaaaaaaa-0000-0000-0000-000000000004',2,i,('2026-07-' || (6+i)::text)::date,'11111111-1111-1111-1111-111111111111','completed') ON CONFLICT DO NOTHING;
  END LOOP;
  INSERT INTO lesson_records (id, student_id, level_id, lesson_number, date, instructor_id, status)
  VALUES (gen_random_uuid(),'aaaaaaaa-0000-0000-0000-000000000004',2,5,'2026-08-19','33333333-3333-3333-3333-333333333333','completed') ON CONFLICT DO NOTHING;
END $$;

-- Leo: lessons 1-2
INSERT INTO lesson_records (id, student_id, level_id, lesson_number, date, instructor_id, status)
VALUES
  (gen_random_uuid(),'aaaaaaaa-0000-0000-0000-000000000005',1,1,'2026-08-05','33333333-3333-3333-3333-333333333333','completed'),
  (gen_random_uuid(),'aaaaaaaa-0000-0000-0000-000000000005',1,2,'2026-08-12','33333333-3333-3333-3333-333333333333','completed')
ON CONFLICT DO NOTHING;

-- Zara: lessons 1-10 complete
DO $$
BEGIN
  FOR i IN 1..10 LOOP
    INSERT INTO lesson_records (id, student_id, level_id, lesson_number, date, instructor_id, status)
    VALUES (gen_random_uuid(),'aaaaaaaa-0000-0000-0000-000000000006',3,i,('2026-06-' || LPAD(((i-1)%5)*4+2::text,2,'0'))::date,'22222222-2222-2222-2222-222222222222','completed') ON CONFLICT DO NOTHING;
  END LOOP;
END $$;

-- Oli: 0 lessons
-- Ruby: lessons 1-6
DO $$
BEGIN
  FOR i IN 1..6 LOOP
    INSERT INTO lesson_records (id, student_id, level_id, lesson_number, date, instructor_id, status)
    VALUES (gen_random_uuid(),'aaaaaaaa-0000-0000-0000-000000000008',1,i,('2026-07-' || (6+i*2)::text)::date,'22222222-2222-2222-2222-222222222222','completed') ON CONFLICT DO NOTHING;
  END LOOP;
END $$;

-- Finn: override set by admin to next lesson 4
INSERT INTO progress_overrides (id, student_id, previous_lesson, new_lesson, reason, admin_id)
VALUES (gen_random_uuid(),'aaaaaaaa-0000-0000-0000-000000000009',1,4,'Transferred from another RoboThink centre; verified prior progress.','11111111-1111-1111-1111-111111111111') ON CONFLICT DO NOTHING;

-- Sample attendance (for a few dates) — show catch-up example for Mia
INSERT INTO attendance (id, student_id, date, scheduled_day, actual_day, time_in, time_out, status, instructor_id, catch_up)
VALUES
  (gen_random_uuid(),'aaaaaaaa-0000-0000-0000-000000000001','2026-08-04','Tuesday','Tuesday','16:02','17:31','Completed','22222222-2222-2222-2222-222222222222',false),
  (gen_random_uuid(),'aaaaaaaa-0000-0000-0000-000000000001','2026-08-11','Tuesday','Tuesday','16:02','17:31','Completed','22222222-2222-2222-2222-222222222222',false),
  (gen_random_uuid(),'aaaaaaaa-0000-0000-0000-000000000001','2026-08-18','Tuesday','Tuesday','16:02','17:31','Completed','22222222-2222-2222-2222-222222222222',false),
  (gen_random_uuid(),'aaaaaaaa-0000-0000-0000-000000000004','2026-08-19','Monday','Wednesday','17:05','18:00','Completed','33333333-3333-3333-3333-333333333333',true)
ON CONFLICT DO NOTHING;

-- Sample assessments
INSERT INTO assessments (id, student_id, type, date, result, instructor_id, notes)
VALUES
  (gen_random_uuid(),'aaaaaaaa-0000-0000-0000-000000000008','Mid-term','2026-08-19','Pass','22222222-2222-2222-2222-222222222222','Confident with sequencing.')
ON CONFLICT DO NOTHING;

-- Sample daily award
INSERT INTO daily_awards (id, date, builder_id, builder_reason, coder_id, coder_reason, recorded_by)
VALUES
  (gen_random_uuid(),'2026-08-25','aaaaaaaa-0000-0000-0000-000000000003','Cleanest gearbox build in the session.','aaaaaaaa-0000-0000-0000-000000000006','Solved the loop challenge fastest.','22222222-2222-2222-2222-222222222222')
ON CONFLICT DO NOTHING;

-- End of seed
