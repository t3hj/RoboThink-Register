-- Multi-centre Phase 1 — students.centre_id + transfer history.
-- 1) students.centre_id (FK to centres) — the student's CURRENT centre.
-- 2) Backfill every existing student to Stanmore Discovery Centre.
-- 3) student_centre_history — one row per (student, centre) stay; to_date NULL
--    while the student is there. A later Stanmore->Hornsey transfer closes the
--    Stanmore row and opens a Hornsey row, so historical records always have an
--    identifiable centre context without being rewritten.
-- 4) Centre-scoped RLS on students (replaces students_read_instructors only;
--    students_admin_all is kept exactly as-is).
-- 5) Indexes following the project's convention (<table>_<col>_idx).
-- Idempotent. No student rows are created, deleted or renamed.

-- Run AFTER 001. Idempotent. No student rows are created, deleted or renamed.
--
-- SAFETY-CRITICAL ORDERING: the staff_centres backfill lives in 001 and MUST
-- have run before the students_read_instructors policy below is replaced,
-- otherwise every existing instructor loses read access between 002 and the
-- point at which they are assigned.

ALTER TABLE public.students
  ADD COLUMN IF NOT EXISTS centre_id uuid REFERENCES public.centres(id);

-- Backfill every existing student to Stanmore. All existing students were
-- single-centre, so this is the historically correct current centre.
--
-- centre_id is deliberately LEFT NULLABLE. The current frontend
-- (components/StudentForm.tsx) inserts students without a centre, so SET NOT
-- NULL here would break the existing add-student flow, which is unrelated
-- application functionality and out of scope for this phase.
--
-- Fail-closed handling instead: can_access_student() treats a NULL-centre
-- student as admin-only. So a centre-less student is never invisible to
-- admins, and is never visible to an instructor by accident. Phase 2 (the
-- centre selector / staff assignment UI) is where new students get a centre
-- at creation time, after which this column can be tightened.
UPDATE public.students
  SET centre_id = (SELECT id FROM public.centres WHERE name = 'Stanmore Discovery Centre')
  WHERE centre_id IS NULL;

-- ------------------------------------------- student-aware centre helpers ----
-- These two live here, not in 001, because they read students.centre_id. They
-- must exist BEFORE the students_read_instructors policy at the end of this
-- file, and before the policies in 003, because PostgreSQL resolves a policy
-- expression when the policy is created.

-- Read a student's CURRENT centre definer-side, so centre-scoped policies on
-- attended_sessions/attendance never have to subquery the RLS'd `students`
-- table from inside their own policy.
CREATE OR REPLACE FUNCTION public.current_student_centre(in_student uuid)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT s.centre_id FROM public.students s WHERE s.id = in_student;
$$;

-- Student ownership rule (used by every student-owned table's RLS):
--   * student with a centre    -> visible to staff assigned to that centre
--   * student with NULL centre -> admin only (fails closed)
--   * unknown student id       -> false (fails closed)
CREATE OR REPLACE FUNCTION public.can_access_student(in_student uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((
    SELECT CASE
             WHEN s.centre_id IS NULL THEN public.is_admin()
             ELSE public.can_access_centre(s.centre_id)
           END
    FROM public.students s
    WHERE s.id = in_student
  ), false);
$$;

REVOKE ALL ON FUNCTION public.current_student_centre(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_access_student(uuid)      FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_student_centre(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_access_student(uuid)      TO authenticated, service_role;

-- ------------------------------------------------- student_centre_history ----
CREATE TABLE IF NOT EXISTS public.student_centre_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  centre_id uuid NOT NULL REFERENCES public.centres(id) ON DELETE CASCADE,
  from_date date NOT NULL,
  to_date date,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (to_date IS NULL OR to_date >= from_date)
);

CREATE INDEX IF NOT EXISTS student_centre_history_student_id_idx
  ON public.student_centre_history(student_id);
CREATE INDEX IF NOT EXISTS student_centre_history_centre_id_idx
  ON public.student_centre_history(centre_id);

-- At most one OPEN (to_date IS NULL) stay per student: this is what makes the
-- table a usable "where is this student now" lookup, and it stops two open
-- rows being inserted by a transfer that forgot to close the previous one.
CREATE UNIQUE INDEX IF NOT EXISTS student_centre_history_one_open_per_student
  ON public.student_centre_history(student_id)
  WHERE to_date IS NULL;

ALTER TABLE public.student_centre_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS student_centre_history_select_staff ON public.student_centre_history;
CREATE POLICY student_centre_history_select_staff ON public.student_centre_history
  FOR SELECT
  USING (public.is_admin() OR public.can_access_centre(student_centre_history.centre_id));

DROP POLICY IF EXISTS student_centre_history_admin_write ON public.student_centre_history;
CREATE POLICY student_centre_history_admin_write ON public.student_centre_history
  FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

GRANT SELECT ON public.student_centre_history TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.student_centre_history TO service_role;

-- History backfill: one open Stanmore row per student, starting at the
-- earliest date we have evidence for (date_joined, else record creation).
-- WHERE NOT EXISTS makes this safe to re-run. The unique partial index above
-- additionally guarantees a student can never get two open rows.
INSERT INTO public.student_centre_history (student_id, centre_id, from_date)
SELECT s.id,
       s.centre_id,
       COALESCE(s.date_joined, s.created_at::date)
FROM public.students s
WHERE s.centre_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.student_centre_history h
    WHERE h.student_id = s.id AND h.to_date IS NULL
  );

CREATE INDEX IF NOT EXISTS students_centre_id_idx ON public.students(centre_id);

-- ------------------------------------------------------------ students RLS ----
-- Admins keep unrestricted access via the untouched students_admin_all policy.
-- Instructors/management keep their existing read access, now narrowed to the
-- students whose CURRENT centre they are assigned to.
--
-- NOTE the explicit parentheses: `A AND (B OR C) OR D` parses as
-- ((A AND B) OR C OR D), which would let the admin branch bypass the centre
-- clause and grant global access. Parenthesised, an admin still passes because
-- can_access_centre() itself short-circuits on is_admin().
DROP POLICY IF EXISTS students_read_instructors ON public.students;
CREATE POLICY students_read_instructors ON public.students
  FOR SELECT
  USING (
    (public.is_admin() OR public.is_instructor() OR public.is_management())
    AND public.can_access_student(students.id)
  );
