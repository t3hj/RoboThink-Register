-- RoboThink schema for PostgreSQL / Supabase
-- Run this in your Supabase project's SQL editor

-- Extensions
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Users / profiles (link to Supabase Auth.users via auth_id)
CREATE TABLE IF NOT EXISTS profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_id uuid, -- reference to auth.users.id when using Supabase Auth
  name text NOT NULL,
  email text UNIQUE,
  role text NOT NULL CHECK (role IN ('admin','instructor')),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Subscriptions
CREATE TABLE IF NOT EXISTS subscriptions (
  id serial PRIMARY KEY,
  name text UNIQUE NOT NULL
);
INSERT INTO subscriptions (name) VALUES ('Elite') ON CONFLICT DO NOTHING;
INSERT INTO subscriptions (name) VALUES ('Term Time') ON CONFLICT DO NOTHING;

-- Levels
CREATE TABLE IF NOT EXISTS levels (
  id serial PRIMARY KEY,
  slug text UNIQUE NOT NULL,
  name text NOT NULL,
  sort_order int NOT NULL DEFAULT 100
);

-- Lessons (curriculum)
CREATE TABLE IF NOT EXISTS lessons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  level_id int NOT NULL REFERENCES levels(id) ON DELETE CASCADE,
  lesson_number int NOT NULL,
  title text NOT NULL,
  description text,
  materials text,
  objectives text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(level_id, lesson_number)
);

-- Students
CREATE TABLE IF NOT EXISTS students (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name text NOT NULL,
  preferred_day text, -- e.g. 'Tuesday'
  preferred_time time, -- preferred session time
  subscription_id int REFERENCES subscriptions(id),
  current_level_id int REFERENCES levels(id),
  date_joined date,
  active boolean NOT NULL DEFAULT true,
  parent_name text,
  parent_contact text,
  notes text,
  override_next_lesson int, -- manual override of next lesson number
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Lesson records (history)
CREATE TABLE IF NOT EXISTS lesson_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  level_id int NOT NULL REFERENCES levels(id) ON DELETE CASCADE,
  lesson_number int NOT NULL,
  date date NOT NULL,
  instructor_id uuid REFERENCES profiles(id),
  status text NOT NULL CHECK (status IN ('completed','not_completed')) DEFAULT 'completed',
  notes text,
  assessment_result text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(student_id, level_id, lesson_number) -- prevent duplicate completed records
);

-- Attendance
CREATE TABLE IF NOT EXISTS attendance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  date date NOT NULL,
  scheduled_day text,
  actual_day text,
  time_in time,
  time_out time,
  status text NOT NULL CHECK (status IN ('Not Arrived','Arrived','Absent','Completed')) DEFAULT 'Not Arrived',
  instructor_id uuid REFERENCES profiles(id),
  catch_up boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(student_id, date)
);

-- Assessments
CREATE TABLE IF NOT EXISTS assessments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  type text NOT NULL,
  date date NOT NULL,
  result text,
  score numeric,
  instructor_id uuid REFERENCES profiles(id),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Daily awards (builder/coder)
CREATE TABLE IF NOT EXISTS daily_awards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  date date UNIQUE NOT NULL,
  builder_id uuid REFERENCES students(id),
  builder_reason text,
  coder_id uuid REFERENCES students(id),
  coder_reason text,
  recorded_by uuid REFERENCES profiles(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Manual progress overrides (audit)
CREATE TABLE IF NOT EXISTS progress_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  previous_lesson int,
  new_lesson int NOT NULL,
  reason text NOT NULL,
  admin_id uuid REFERENCES profiles(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Audit log
CREATE TABLE IF NOT EXISTS audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid,
  actor_name text,
  action text NOT NULL,
  object_type text,
  object_id text,
  before jsonb,
  after jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Helper: total lessons per level
CREATE VIEW total_lessons_per_level AS
SELECT level_id, MAX(lesson_number)::int AS total_lessons
FROM lessons
GROUP BY level_id;

-- Function: compute_next_lesson(student_uuid) -> integer
-- Business rule (source of truth is completed lessons):
-- 1) Find max completed lesson_number for student's current level
-- 2) If student.override_next_lesson > maxCompleted, return override
-- 3) Return maxCompleted + 1

CREATE OR REPLACE FUNCTION compute_next_lesson(in_student uuid)
RETURNS integer LANGUAGE plpgsql AS $$
DECLARE
  lvl int;
  max_completed int := 0;
  override int;
BEGIN
  SELECT current_level_id INTO lvl FROM students WHERE id = in_student;
  IF lvl IS NULL THEN
    RAISE EXCEPTION 'Student % has no current_level_id set', in_student;
  END IF;

  SELECT COALESCE(MAX(lesson_number),0) INTO max_completed
    FROM lesson_records
    WHERE student_id = in_student AND level_id = lvl AND status = 'completed';

  SELECT override_next_lesson INTO override FROM students WHERE id = in_student;
  IF override IS NOT NULL AND override > max_completed THEN
    RETURN override;
  END IF;
  RETURN max_completed + 1;
END; $$;

-- Example convenience view: student progress
CREATE OR REPLACE VIEW student_progress AS
SELECT s.id as student_id, s.full_name, s.preferred_day, s.preferred_time, l.name as level_name, COALESCE(t.total_lessons,0) as total_lessons,
  compute_next_lesson(s.id) as next_lesson
FROM students s
LEFT JOIN levels l ON s.current_level_id = l.id
LEFT JOIN total_lessons_per_level t ON t.level_id = s.current_level_id;

-- NOTES ON ROLES / RLS (Supabase):
-- * Use Supabase Auth (auth.users). Link profiles.auth_id to auth.users.id.
-- * Enable Row Level Security on tables and add policies:
--   - profiles: allow users to read their own profile; admins can read/write all
--   - students/attendance/lesson_records: instructors and admins should be able to read/write; parents should be restricted
-- * Keep audit_log writes restricted to server/service_role or functions invoked via Edge Functions

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_lesson_records_student ON lesson_records(student_id);
CREATE INDEX IF NOT EXISTS idx_attendance_date ON attendance(date);
CREATE INDEX IF NOT EXISTS idx_students_level ON students(current_level_id);

-- End of schema
