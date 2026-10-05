-- Synthetic development seed data only.
-- Do not place real student, parent, staff, or curriculum content in this file.
-- Run only in a disposable development Supabase project.

INSERT INTO profiles (id, name, email, role) VALUES
  ('11111111-1111-1111-1111-111111111111', 'Demo Admin', 'admin@example.invalid', 'admin'),
  ('22222222-2222-2222-2222-222222222222', 'Demo Instructor', 'instructor@example.invalid', 'instructor')
ON CONFLICT DO NOTHING;

INSERT INTO levels (id, slug, name, sort_order) VALUES
  (1, 'demo-level-1', 'Demo Level 1', 1),
  (2, 'demo-level-2', 'Demo Level 2', 2)
ON CONFLICT DO NOTHING;

INSERT INTO subscriptions (name) VALUES
  ('Demo Subscription')
ON CONFLICT DO NOTHING;

INSERT INTO lessons (
  id, level_id, lesson_number, title, description, materials, objectives, notes
) VALUES
  (
    'dddddddd-0000-0000-0000-000000000001',
    1,
    1,
    'Placeholder Lesson 1',
    'Synthetic placeholder lesson for local development.',
    'Placeholder materials',
    'Placeholder objectives',
    'Replace with authorised curriculum data in a private environment.'
  ),
  (
    'dddddddd-0000-0000-0000-000000000002',
    1,
    2,
    'Placeholder Lesson 2',
    'Synthetic placeholder lesson for local development.',
    'Placeholder materials',
    'Placeholder objectives',
    NULL
  ),
  (
    'dddddddd-0000-0000-0000-000000000003',
    2,
    1,
    'Placeholder Lesson 1',
    'Synthetic placeholder lesson for local development.',
    'Placeholder materials',
    'Placeholder objectives',
    NULL
  )
ON CONFLICT DO NOTHING;

INSERT INTO students (
  id, full_name, preferred_day, preferred_time, subscription_id,
  current_level_id, date_joined, parent_name, parent_contact, notes, active
) VALUES
  (
    'aaaaaaaa-0000-0000-0000-000000000001',
    'Demo Student One',
    'Tuesday',
    '16:00',
    (SELECT id FROM subscriptions WHERE name = 'Demo Subscription'),
    1,
    '2026-01-01',
    'Demo Parent One',
    '00000 000001',
    'Synthetic record for local development.',
    true
  ),
  (
    'aaaaaaaa-0000-0000-0000-000000000002',
    'Demo Student Two',
    'Wednesday',
    '17:00',
    (SELECT id FROM subscriptions WHERE name = 'Demo Subscription'),
    2,
    '2026-01-01',
    'Demo Parent Two',
    '00000 000002',
    NULL,
    true
  )
ON CONFLICT DO NOTHING;

INSERT INTO lesson_records (
  student_id, level_id, lesson_number, date, instructor_id, status
) VALUES
  (
    'aaaaaaaa-0000-0000-0000-000000000001',
    1,
    1,
    '2026-01-06',
    '22222222-2222-2222-2222-222222222222',
    'completed'
  )
ON CONFLICT DO NOTHING;

INSERT INTO attendance (
  student_id, date, scheduled_day, actual_day, time_in, time_out,
  status, instructor_id, catch_up
) VALUES
  (
    'aaaaaaaa-0000-0000-0000-000000000001',
    '2026-01-06',
    'Tuesday',
    'Tuesday',
    '16:00',
    '17:00',
    'Completed',
    '22222222-2222-2222-2222-222222222222',
    false
  )
ON CONFLICT DO NOTHING;
