-- 1. Several weekly sessions per student, 2. managers can add/edit students,
-- 3. instructor "add student" requests that an admin or manager approves.
-- Additive only: students.preferred_day / preferred_time stay in place as the
-- student's first session, so older code keeps working.

-- ---------------------------------------------------------------------------
-- 1. student_schedules becomes the list of a student's weekly sessions.
--    Copy every active student's current day/time in as an EVERY_WEEK slot
--    (students that already have schedule rows are left alone).
-- ---------------------------------------------------------------------------
INSERT INTO public.student_schedules (student_id, day_of_week, start_time, week_pattern, active)
SELECT s.id, s.preferred_day, s.preferred_time, 'EVERY_WEEK', true
FROM public.students s
WHERE s.active
  AND s.preferred_day IS NOT NULL
  AND s.preferred_time IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.student_schedules x WHERE x.student_id = s.id)
ON CONFLICT DO NOTHING;

DROP POLICY IF EXISTS student_schedules_write_admin_manager ON public.student_schedules;
CREATE POLICY student_schedules_write_admin_manager ON public.student_schedules
  FOR ALL
  USING ((is_admin() OR is_management()) AND can_access_student(student_id))
  WITH CHECK ((is_admin() OR is_management()) AND can_access_student(student_id));

-- ---------------------------------------------------------------------------
-- 2. Managers can add and edit students at centres they can access.
--    (Admins already have students_admin_all.)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS students_management_insert ON public.students;
CREATE POLICY students_management_insert ON public.students
  FOR INSERT
  WITH CHECK (is_management() AND brand = current_app_brand() AND can_access_centre(centre_id));

DROP POLICY IF EXISTS students_management_update ON public.students;
CREATE POLICY students_management_update ON public.students
  FOR UPDATE
  USING (is_management() AND brand = current_app_brand() AND can_access_student(id))
  WITH CHECK (is_management() AND brand = current_app_brand() AND can_access_centre(centre_id));

-- ---------------------------------------------------------------------------
-- 3. Student requests. Nothing here creates a student: an admin or manager
--    reviews a request and, on approval, adds the student through the normal
--    form. The request just records who asked, for which centre, and the outcome.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.student_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  centre_id uuid NOT NULL REFERENCES public.centres(id),
  brand text NOT NULL DEFAULT 'robothink',
  requested_by uuid NOT NULL REFERENCES public.profiles(id),
  status text NOT NULL DEFAULT 'pending',
  payload jsonb NOT NULL,
  review_note text,
  reviewed_by uuid REFERENCES public.profiles(id),
  reviewed_at timestamptz,
  created_student_id uuid REFERENCES public.students(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT student_requests_status_allowed CHECK (status IN ('pending', 'approved', 'rejected')),
  CONSTRAINT student_requests_brand_allowed CHECK (brand IN ('robothink', 'creative_iq')),
  CONSTRAINT student_requests_name_present CHECK (length(trim(coalesce(payload->>'full_name', ''))) > 0)
);

CREATE INDEX IF NOT EXISTS student_requests_status_idx ON public.student_requests (status, created_at DESC);
CREATE INDEX IF NOT EXISTS student_requests_centre_idx ON public.student_requests (centre_id);

ALTER TABLE public.student_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS student_requests_select ON public.student_requests;
CREATE POLICY student_requests_select ON public.student_requests
  FOR SELECT
  USING (
    brand = current_app_brand()
    AND (
      requested_by = (SELECT p.id FROM public.profiles p WHERE p.auth_id = auth.uid())
      OR ((is_admin() OR is_management()) AND can_access_centre(centre_id))
    )
  );

DROP POLICY IF EXISTS student_requests_insert ON public.student_requests;
CREATE POLICY student_requests_insert ON public.student_requests
  FOR INSERT
  WITH CHECK (
    (is_instructor() OR is_admin() OR is_management())
    AND brand = current_app_brand()
    AND status = 'pending'
    AND requested_by = (SELECT p.id FROM public.profiles p WHERE p.auth_id = auth.uid())
    AND can_access_centre(centre_id)
  );

DROP POLICY IF EXISTS student_requests_review ON public.student_requests;
CREATE POLICY student_requests_review ON public.student_requests
  FOR UPDATE
  USING ((is_admin() OR is_management()) AND brand = current_app_brand() AND can_access_centre(centre_id))
  WITH CHECK ((is_admin() OR is_management()) AND brand = current_app_brand() AND can_access_centre(centre_id));

COMMENT ON TABLE public.student_requests IS 'Instructor requests to add a student, reviewed by an admin or manager.';
