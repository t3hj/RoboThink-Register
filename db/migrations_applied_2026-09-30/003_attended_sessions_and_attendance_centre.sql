-- Multi-centre Phase 1 — historical centre snapshots for date-scoped rows.
-- Run AFTER 002. Idempotent; no existing rows are deleted or reinterpreted.
--
-- WHY attendance gets its own centre_id snapshot:
--   attendance is the per-date register row (UNIQUE(student_id, date)). If its
--   centre were derived from students.centre_id at query time, a later
--   Stanmore -> Hornsey transfer would silently rewrite where every historical
--   register row appears to have happened. Deriving is therefore unsafe for
--   history; the centre at the time of the register row must be snapshotted.
--   Same reasoning applies to attended_sessions.
--
-- WHY lesson_records / feedback_sheets / assessments / remediation do NOT get
-- a centre column: they are student-progression-owned (lesson_records is the
-- per-lesson ledger keyed by student; feedback derives from sessions; the
-- assessment/remediation chain is keyed by student). Their centre is derived
-- through can_access_student() at RLS time. Stamping them separately would
-- create multiple sources of truth.
--
-- Backfill uses each student's CURRENT centre (all existing students were just
-- backfilled to Stanmore in 002). Once applied, this column is NEVER updated
-- when a student transfers — a transfer only changes students.centre_id and
-- student_centre_history; new rows snapshot the new centre at insert time
-- (record_attended_session in 005, and the stamp_centre_from_student trigger
-- below for the frontend's direct attendance upserts).
--
-- Idempotent; no existing rows are deleted or reinterpreted.

-- ------------------------------------------------- attended_sessions ----------
ALTER TABLE public.attended_sessions
  ADD COLUMN IF NOT EXISTS centre_id uuid REFERENCES public.centres(id);

-- Backfill historical sessions from the student's centre (all Stanmore now).
UPDATE public.attended_sessions a
SET centre_id = s.centre_id
FROM public.students s
WHERE a.student_id = s.id AND a.centre_id IS NULL;

-- centre_id is NOT set NOT NULL. attended_sessions rows are only ever created
-- by record_attended_session() (migration 005), which stamps the student's
-- centre explicitly, so this backfill is complete. Leaving the column nullable
-- keeps the migration non-destructive and avoids failing on any row whose
-- student was deleted between the UPDATE and the constraint being added.
CREATE INDEX IF NOT EXISTS attended_sessions_centre_id_idx
  ON public.attended_sessions(centre_id);

-- ------------------------------------------------------- attendance ----------
ALTER TABLE public.attendance
  ADD COLUMN IF NOT EXISTS centre_id uuid REFERENCES public.centres(id);

UPDATE public.attendance a
SET centre_id = s.centre_id
FROM public.students s
WHERE a.student_id = s.id AND a.centre_id IS NULL;

CREATE INDEX IF NOT EXISTS attendance_centre_id_idx ON public.attendance(centre_id);

-- ---------------------------------------------------- centre stamping trigger --
-- SAFETY-CRITICAL CONTEXT: unlike attended_sessions, `attendance` is written
-- DIRECTLY by the frontend (pages/Register.tsx, components/SessionEntryRow.tsx,
-- AddToRegister.tsx, BulkAttendanceModal.tsx all upsert straight into the
-- table) and those upserts never send a centre_id. So the column CANNOT be
-- NOT NULL here, and something has to supply it. This trigger does, at write
-- time, so the snapshot reflects where the student was when the register row
-- was written rather than being derived at read time.
--
-- The two operations need OPPOSITE treatment, which is the whole subtlety:
--
--   INSERT -> the centre is being captured for the first time. The supplied
--             value is ALWAYS overwritten with the student's current centre.
--             Callers never get to name the centre, so there is nothing to
--             spoof. (The INSERT RLS policy additionally requires
--             centre_id = current_student_centre(student_id), so a mismatch is
--             rejected outright before this trigger is even relevant.)
--
--   UPDATE -> the centre is a historical snapshot and must NOT move. Two cases:
--             * student_id unchanged (the normal case: the register edits
--               status/time_in/time_out/session_type). Any change to centre_id
--               is a spoof attempt and is REJECTED. This is what stops an
--               instructor relocating a historical register row.
--             * student_id changed (the row is being reassigned to a different
--               student entirely). The snapshot is meaningless for the new
--               student, so it is re-derived. This can only ever happen via
--               admin, since attendance rows are never re-keyed by the UI.
--
--   Either way, a later transfer of the student does NOT touch this column:
--   transfer_student_to_centre() (007) only writes students and
--   student_centre_history, never attendance.
--
--   BEFORE INSERT OR UPDATE (not "UPDATE OF student_id") on purpose: a
--   column-specific trigger would not fire for a plain status update, leaving
--   centre_id unvalidated on exactly the path the register uses most.
CREATE OR REPLACE FUNCTION public.stamp_centre_from_student()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- Capture: always the student's centre as of right now. Whatever the
    -- caller supplied is discarded.
    SELECT s.centre_id INTO NEW.centre_id
    FROM public.students s
    WHERE s.id = NEW.student_id;
    RETURN NEW;
  END IF;

  -- TG_OP = 'UPDATE'
  IF NEW.student_id IS DISTINCT FROM OLD.student_id THEN
    -- Row re-keyed to another student: the old snapshot no longer applies.
    SELECT s.centre_id INTO NEW.centre_id
    FROM public.students s
    WHERE s.id = NEW.student_id;
    RETURN NEW;
  END IF;

  IF NEW.centre_id IS DISTINCT FROM OLD.centre_id THEN
    RAISE EXCEPTION
      'attendance.centre_id is a historical snapshot and cannot be changed directly (row for student % on %)',
      OLD.student_id, OLD.date;
  END IF;

  RETURN NEW;
END;
$$;

-- One trigger definition shared by both tables. BEFORE INSERT OR UPDATE, and
-- never column-scoped, so every write path is covered.
DROP TRIGGER IF EXISTS attended_sessions_stamp_centre ON public.attended_sessions;
CREATE TRIGGER attended_sessions_stamp_centre
  BEFORE INSERT OR UPDATE ON public.attended_sessions
  FOR EACH ROW EXECUTE FUNCTION public.stamp_centre_from_student();

DROP TRIGGER IF EXISTS attendance_stamp_centre ON public.attendance;
CREATE TRIGGER attendance_stamp_centre
  BEFORE INSERT OR UPDATE ON public.attendance
  FOR EACH ROW EXECUTE FUNCTION public.stamp_centre_from_student();

-- Backstop: a centre-less historical row is never valid. Added NOT VALID so
-- existing rows are not re-scanned (they were just backfilled), but any future
-- INSERT/UPDATE is checked. Wrapped in a guard because PostgreSQL has no
-- "ADD CONSTRAINT IF NOT EXISTS" and this file must be re-runnable.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'attended_sessions_centre_id_required'
  ) THEN
    ALTER TABLE public.attended_sessions
      ADD CONSTRAINT attended_sessions_centre_id_required
      CHECK (centre_id IS NOT NULL) NOT VALID;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'attendance_centre_id_required'
  ) THEN
    ALTER TABLE public.attendance
      ADD CONSTRAINT attendance_centre_id_required
      CHECK (centre_id IS NOT NULL) NOT VALID;
  END IF;
END $$;

REVOKE ALL ON FUNCTION public.stamp_centre_from_student() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.stamp_centre_from_student() TO authenticated, service_role;

-- --------------------------------------------------------------- RLS ----------
-- attended_sessions: replace the two original policies (attended_sessions_
-- select_staff, attended_sessions_write_staff from 2026-09-20/001) with
-- centre-scoped ones. The old insert policy was global for any instructor.
DROP POLICY IF EXISTS attended_sessions_select_staff ON public.attended_sessions;
DROP POLICY IF EXISTS attended_sessions_write_staff ON public.attended_sessions;
DROP POLICY IF EXISTS attended_sessions_select       ON public.attended_sessions;
DROP POLICY IF EXISTS attended_sessions_insert       ON public.attended_sessions;
DROP POLICY IF EXISTS attended_sessions_update       ON public.attended_sessions;
DROP POLICY IF EXISTS attended_sessions_delete_admin ON public.attended_sessions;

-- The "does this session's centre match where the student is NOW" check uses
-- current_student_centre() (SECURITY DEFINER) rather than a subquery on
-- `students`. A direct subquery would be evaluated under students' own RLS
-- from inside an attended_sessions policy; the helper keeps the check exact
-- and independent of how students' policies are later changed.
CREATE POLICY attended_sessions_select ON public.attended_sessions
  FOR SELECT
  USING (
    (public.is_admin() OR public.is_instructor() OR public.is_management())
    AND public.can_access_centre(centre_id)
  );

-- INSERT: caller must be admin/instructor, have access to the centre being
-- stamped, and that centre must be the student's CURRENT centre (a new
-- session is recorded where the student is now, not retroactively elsewhere).
CREATE POLICY attended_sessions_insert ON public.attended_sessions
  FOR INSERT
  WITH CHECK (
    (public.is_admin() OR public.is_instructor())
    AND public.can_access_centre(centre_id)
    AND (
      public.is_admin()
      OR centre_id = public.current_student_centre(student_id)
    )
  );

-- UPDATE: both the existing row (USING) and the new values (WITH CHECK) are
-- checked, so a caller cannot re-point a row at another centre.
CREATE POLICY attended_sessions_update ON public.attended_sessions
  FOR UPDATE
  USING (
    (public.is_admin() OR public.is_instructor())
    AND public.can_access_centre(centre_id)
  )
  WITH CHECK (
    (public.is_admin() OR public.is_instructor())
    AND public.can_access_centre(centre_id)
    AND (
      public.is_admin()
      OR centre_id = public.current_student_centre(student_id)
    )
  );

CREATE POLICY attended_sessions_delete_admin ON public.attended_sessions
  FOR DELETE
  USING (public.is_admin());

-- attendance: same model, same original policy names as 2026-09-15/002 so the
-- drop/create stays a like-for-like replacement. The instructor_id ownership
-- rule from robothink_rls.sql is preserved verbatim. The centre-consistency
-- check is intentionally only on INSERT: attendance rows are upserted
-- (ON CONFLICT student_id,date) by the frontend for past dates too, and a
-- re-submitted historical row must not be rejected for legitimately holding an
-- older centre snapshot.
DROP POLICY IF EXISTS attendance_select_staff ON public.attendance;
CREATE POLICY attendance_select_staff ON public.attendance
  FOR SELECT
  USING (
    (public.is_admin() OR public.is_instructor() OR public.is_management())
    AND public.can_access_centre(centre_id)
  );

DROP POLICY IF EXISTS attendance_insert_staff ON public.attendance;
CREATE POLICY attendance_insert_staff ON public.attendance
  FOR INSERT
  WITH CHECK (
    (public.is_admin() OR public.is_instructor())
    AND (
      instructor_id IS NULL
      OR instructor_id = (SELECT id FROM public.profiles WHERE auth_id = auth.uid()::uuid)
      OR public.is_admin()
    )
    AND public.can_access_centre(centre_id)
    AND (
      public.is_admin()
      OR centre_id = public.current_student_centre(student_id)
    )
  );

DROP POLICY IF EXISTS attendance_update_staff ON public.attendance;
CREATE POLICY attendance_update_staff ON public.attendance
  FOR UPDATE
  USING (
    (public.is_admin() OR public.is_instructor())
    AND (
      instructor_id IS NULL
      OR instructor_id = (SELECT id FROM public.profiles WHERE auth_id = auth.uid()::uuid)
      OR public.is_admin()
    )
    AND public.can_access_centre(centre_id)
  )
  WITH CHECK (
    (public.is_admin() OR public.is_instructor())
    AND (
      instructor_id IS NULL
      OR instructor_id = (SELECT id FROM public.profiles WHERE auth_id = auth.uid()::uuid)
      OR public.is_admin()
    )
    AND public.can_access_centre(centre_id)
  );

-- attendance_delete_admin already exists (migration_001); left untouched.
