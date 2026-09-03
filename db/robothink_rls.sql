-- RoboThink RLS and Auth mapping SQL
-- Run this in your Supabase project's SQL editor AFTER running the schema and seed files.

-- Helper functions to check role based on profiles.auth_id = auth.uid()
-- These functions can be used in RLS policies to allow admin/instructor specific access.

create or replace function public.is_admin() returns boolean language sql stable as $$
  select exists(select 1 from public.profiles p where p.auth_id = auth.uid()::uuid and p.role = 'admin');
$$;

create or replace function public.is_instructor() returns boolean language sql stable as $$
  select exists(select 1 from public.profiles p where p.auth_id = auth.uid()::uuid and p.role = 'instructor');
$$;

-- Enable Row Level Security on relevant tables
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.students ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lesson_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assessments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_awards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.progress_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

-- ---------------- profiles ----------------
-- Profiles: allow users to insert their own profile (during onboarding) and select/update their profile.
-- Admins (profiles.role='admin') can read/write all profiles.

-- Allow admins to select/insert/update/delete any profile
CREATE POLICY profiles_admin_all ON public.profiles
  USING ( public.is_admin() )
  WITH CHECK ( public.is_admin() );

-- Allow authenticated users to select their own profile
CREATE POLICY profiles_select_own ON public.profiles
  FOR SELECT USING ( auth.uid()::uuid IS NOT NULL AND auth.uid()::uuid = auth_id );

-- Allow users to create their own profile (auth_id must match)
CREATE POLICY profiles_insert_own ON public.profiles
  FOR INSERT WITH CHECK ( auth.uid()::uuid IS NOT NULL AND auth.uid()::uuid = auth_id );

-- Allow users to update their own profile
CREATE POLICY profiles_update_own ON public.profiles
  FOR UPDATE USING ( auth.uid()::uuid = auth_id ) WITH CHECK ( auth.uid()::uuid = auth_id );

-- ---------------- students ----------------
-- Students: admins can insert/update/delete; instructors can select and insert/update attendance & lesson records separately.

-- Admins: full access
CREATE POLICY students_admin_all ON public.students
  FOR ALL USING ( public.is_admin() ) WITH CHECK ( public.is_admin() );

-- Instructors: allow read (view student list) but not insert/delete students
CREATE POLICY students_read_instructors ON public.students
  FOR SELECT USING ( public.is_instructor() OR public.is_admin() );

-- ---------------- attendance ----------------
-- Attendance: instructors and admins may insert/select/update. Enforce that instructor_id (if provided) must belong to the requesting user.

CREATE POLICY attendance_select_staff ON public.attendance
  FOR SELECT USING ( public.is_instructor() OR public.is_admin() );

CREATE POLICY attendance_insert_staff ON public.attendance
  FOR INSERT WITH CHECK (
    (
      -- requesting user must be instructor or admin
      public.is_instructor() OR public.is_admin()
    )
    AND (
      -- if instructor_id is supplied, it must belong to the requesting auth user (or be null)
      (instructor_id IS NULL) OR (instructor_id = (select id from public.profiles where auth_id = auth.uid()::uuid)) OR public.is_admin()
    )
);

CREATE POLICY attendance_update_staff ON public.attendance
  FOR UPDATE USING ( public.is_instructor() OR public.is_admin() ) WITH CHECK (
    (public.is_instructor() OR public.is_admin()) AND
    ( (instructor_id IS NULL) OR (instructor_id = (select id from public.profiles where auth_id = auth.uid()::uuid)) OR public.is_admin() )
  );

-- ---------------- lesson_records ----------------
-- Lesson records: instructors and admins may insert; enforce instructor_id belongs to the user (or admin).

CREATE POLICY lesson_records_select_staff ON public.lesson_records
  FOR SELECT USING ( public.is_instructor() OR public.is_admin() );

CREATE POLICY lesson_records_insert_staff ON public.lesson_records
  FOR INSERT WITH CHECK (
    (public.is_instructor() OR public.is_admin()) AND
    ( (instructor_id IS NULL) OR (instructor_id = (select id from public.profiles where auth_id = auth.uid()::uuid)) OR public.is_admin() )
  );

CREATE POLICY lesson_records_update_staff ON public.lesson_records
  FOR UPDATE USING ( public.is_instructor() OR public.is_admin() ) WITH CHECK (
    (public.is_instructor() OR public.is_admin()) AND
    ( (instructor_id IS NULL) OR (instructor_id = (select id from public.profiles where auth_id = auth.uid()::uuid)) OR public.is_admin() )
  );

-- Prevent public writes by default on lesson_records; above policy gates writes.

-- ---------------- assessments ----------------
CREATE POLICY assessments_select_staff ON public.assessments
  FOR SELECT USING ( public.is_instructor() OR public.is_admin() );

CREATE POLICY assessments_insert_staff ON public.assessments
  FOR INSERT WITH CHECK (
    (public.is_instructor() OR public.is_admin()) AND
    ( (instructor_id IS NULL) OR (instructor_id = (select id from public.profiles where auth_id = auth.uid()::uuid)) OR public.is_admin() )
  );

CREATE POLICY assessments_update_staff ON public.assessments
  FOR UPDATE USING ( public.is_instructor() OR public.is_admin() ) WITH CHECK (
    (public.is_instructor() OR public.is_admin()) AND
    ( (instructor_id IS NULL) OR (instructor_id = (select id from public.profiles where auth_id = auth.uid()::uuid)) OR public.is_admin() )
  );

-- ---------------- daily_awards ----------------
CREATE POLICY daily_awards_select_staff ON public.daily_awards
  FOR SELECT USING ( public.is_instructor() OR public.is_admin() );

CREATE POLICY daily_awards_insert_staff ON public.daily_awards
  FOR INSERT WITH CHECK (
    (public.is_instructor() OR public.is_admin()) AND
    ( (recorded_by IS NULL) OR (recorded_by = (select id from public.profiles where auth_id = auth.uid()::uuid)) OR public.is_admin() )
  );

CREATE POLICY daily_awards_update_staff ON public.daily_awards
  FOR UPDATE USING ( public.is_instructor() OR public.is_admin() ) WITH CHECK (
    (public.is_instructor() OR public.is_admin()) AND
    ( (recorded_by IS NULL) OR (recorded_by = (select id from public.profiles where auth_id = auth.uid()::uuid)) OR public.is_admin() )
  );

-- ---------------- progress_overrides ----------------
-- Only admins may insert/update/delete overrides
CREATE POLICY overrides_admin_only ON public.progress_overrides
  FOR ALL USING ( public.is_admin() ) WITH CHECK ( public.is_admin() );

-- ---------------- audit_log ----------------
-- Only admins may write to audit_log. Reading audit_log can be restricted to admins too.
CREATE POLICY audit_log_admin_insert ON public.audit_log
  FOR INSERT WITH CHECK ( public.is_admin() );

CREATE POLICY audit_log_admin_select ON public.audit_log
  FOR SELECT USING ( public.is_admin() );

-- ---------------- helper notes ----------------
-- The policies above assume that profiles.auth_id is populated with the corresponding auth.users.id (UUID).
-- To map an auth user to a profile, run the SQL below (replace placeholders with real auth.user ids from your Supabase Auth dashboard):

-- Example: map the user with email dan@example.com (or their auth.id) to the profile we created in the seed.
-- 1) Find the auth.users.id for the email (from Supabase dashboard) — suppose it's 'aaabbbcc-dddd-eeee-ffff-111122223333'
-- 2) Run:
--   UPDATE public.profiles SET auth_id = 'aaabbbcc-dddd-eeee-ffff-111122223333' WHERE email = 'dan@example.com';

-- If you prefer to do this in SQL using the auth.users table (requires service_role key / SQL access), you can run:
-- Note: The auth schema is managed by Supabase and direct inserts into auth.users should be done via Admin API or dashboard for safety.

-- Example to map multiple instructor emails — replace auth_id values with those you obtain:
-- UPDATE public.profiles SET auth_id = '11111111-aaaa-1111-aaaa-111111111111' WHERE email = 'dan@example.com';
-- UPDATE public.profiles SET auth_id = '22222222-bbbb-2222-bbbb-222222222222' WHERE email = 'priya@example.com';
-- UPDATE public.profiles SET auth_id = '33333333-cccc-3333-cccc-333333333333' WHERE email = 'sam@example.com';

-- IMPORTANT: After mapping profiles.auth_id, test policies by signing in as an instructor and attempting actions (insert attendance, record lessons).
-- If you need to allow a service/CI or server to bypass RLS (for administrative scripts), use the Supabase service_role key (server-side) — do NOT embed it in client code.

-- End of RLS and auth mapping SQL
