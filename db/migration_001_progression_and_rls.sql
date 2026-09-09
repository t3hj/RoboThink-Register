-- Migration 001: lesson progression & RLS hardening
-- Run in the Supabase SQL editor AFTER robothink_schema.sql, robothink_seed_fixed.sql and robothink_rls.sql.
-- Safe to re-run (idempotent).

-- ============================================================
-- 1. Harden compute_next_lesson
-- ------------------------------------------------------------
-- Original behaviour (kept, with fixes):
--   1) next = max(completed lesson_number) + 1 for the student's current level
--   2) an override higher than max completed wins
-- Fixes:
--   * falls back to the student's most recent level if current_level_id is NULL
--     instead of raising (level changes mid-progression are supported)
--   * completed lessons for the current level are never "re-served": the UNIQUE
--     (student_id, level_id, lesson_number) constraint plus MAX()+1 guarantees
--     the next lesson is always strictly beyond anything already completed
--   * a missed lesson is simply not completed, so it stays next until done
--   * ignores non-'completed' records (not_completed rows don't advance progress)
--   * returns NULL (not an exception) when the student has no level at all, so
--     the UI can show "—" instead of failing the whole register load
-- ============================================================
CREATE OR REPLACE FUNCTION public.compute_next_lesson(in_student uuid)
RETURNS integer
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  lvl int;
  max_completed int := 0;
  override int;
BEGIN
  SELECT current_level_id INTO lvl FROM students WHERE id = in_student;

  IF lvl IS NULL THEN
    -- Fall back to the most recent level the student has any completed lesson in
    SELECT level_id INTO lvl
    FROM lesson_records
    WHERE student_id = in_student AND status = 'completed'
    ORDER BY date DESC
    LIMIT 1;
  END IF;

  IF lvl IS NULL THEN
    RETURN NULL; -- student has no level at all yet
  END IF;

  SELECT COALESCE(MAX(lesson_number), 0) INTO max_completed
  FROM lesson_records
  WHERE student_id = in_student AND level_id = lvl AND status = 'completed';

  SELECT override_next_lesson INTO override FROM students WHERE id = in_student;

  IF override IS NOT NULL AND override > max_completed THEN
    RETURN override;
  END IF;

  RETURN max_completed + 1;
END;
$$;

-- ============================================================
-- 2. Register convenience RPC: next lesson for many students in one call
--    (replaces per-student RPC calls — removes the register's N+1)
-- ============================================================
CREATE OR REPLACE FUNCTION public.next_lessons_for_students(in_ids uuid[])
RETURNS TABLE (student_id uuid, next_lesson int)
LANGUAGE sql
STABLE
AS $$
  SELECT s.id, public.compute_next_lesson(s.id)
  FROM unnest(in_ids) AS s(id)
  JOIN students st ON st.id = s.id;
$$;

-- The student_progress view already exposes next_lesson per student and is
-- readable by staff via RLS on the underlying tables, so the frontend uses it
-- for batched lookups. This RPC is provided for callers that prefer arrays.

-- ============================================================
-- 3. RLS hardening
-- ------------------------------------------------------------
-- Gaps found in robothink_rls.sql:
--   a) profiles: a user could update their OWN role to 'admin'
--      (profiles_update_own had no WITH CHECK on role change)
--   b) lesson_records / attendance / assessments / daily_awards had no DELETE
--      policies: no one (even admins) could remove a wrongly-recorded row
--   c) students: instructors could not insert attendance rows that reference a
--      student they can already read — fine — but students UPDATE was admin-only
--      while the frontend relied on instructor-writable fields (override) —
--      that is intentional: only admins set overrides (progress_overrides is
--      admin-only). Students table stays read-only for instructors.
--   d) audit_log: unauthenticated users were blocked, but everyone authenticated
--      could attempt inserts only as admin — kept, plus an explicit
--      authenticated UPDATE policy was missing entirely (no updates allowed,
--      correct for an append-only log).
-- ============================================================

-- (a) users cannot promote themselves: own-profile updates may not change role
DROP POLICY IF EXISTS profiles_update_own ON public.profiles;
CREATE POLICY profiles_update_own ON public.profiles
  FOR UPDATE
  USING ( auth.uid()::uuid = auth_id )
  WITH CHECK ( auth.uid()::uuid = auth_id AND role = (SELECT p.role FROM public.profiles p WHERE p.auth_id = auth.uid()::uuid) );

-- (b) allow admins to delete mistaken attendance / lesson records / assessments
DROP POLICY IF EXISTS attendance_delete_admin ON public.attendance;
CREATE POLICY attendance_delete_admin ON public.attendance
  FOR DELETE USING ( public.is_admin() );

DROP POLICY IF EXISTS lesson_records_delete_admin ON public.lesson_records;
CREATE POLICY lesson_records_delete_admin ON public.lesson_records
  FOR DELETE USING ( public.is_admin() );

DROP POLICY IF EXISTS assessments_delete_admin ON public.assessments
;
CREATE POLICY assessments_delete_admin ON public.assessments
  FOR DELETE USING ( public.is_admin() );

-- (d) no UPDATE policy is created for audit_log: append-only by design.

-- ============================================================
-- 4. Data integrity triggers
-- ------------------------------------------------------------
-- Prevent invalid states the UI can no longer produce but which could be
-- introduced by other clients:
--   * lesson completion must have a date <= today and a known lesson number
--   * attendance time_out, when set, must not be before time_in
-- ============================================================
CREATE OR REPLACE FUNCTION public.validate_lesson_record() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.date > CURRENT_DATE THEN
    RAISE EXCEPTION 'lesson_records.date cannot be in the future';
  END IF;
  IF NEW.status = 'completed' THEN
    IF NOT EXISTS (SELECT 1 FROM lessons WHERE level_id = NEW.level_id AND lesson_number = NEW.lesson_number) THEN
      RAISE EXCEPTION 'lesson % does not exist in level %', NEW.lesson_number, NEW.level_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_lesson_record ON public.lesson_records;
CREATE TRIGGER trg_validate_lesson_record
  BEFORE INSERT OR UPDATE ON public.lesson_records
  FOR EACH ROW EXECUTE FUNCTION public.validate_lesson_record();

CREATE OR REPLACE FUNCTION public.validate_attendance() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.date > CURRENT_DATE THEN
    RAISE EXCEPTION 'attendance.date cannot be in the future';
  END IF;
  IF NEW.time_in IS NOT NULL AND NEW.time_out IS NOT NULL AND NEW.time_out < NEW.time_in THEN
    RAISE EXCEPTION 'attendance time_out cannot be before time_in';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_attendance ON public.attendance;
CREATE TRIGGER trg_validate_attendance
  BEFORE INSERT OR UPDATE ON public.attendance
  FOR EACH ROW EXECUTE FUNCTION public.validate_attendance();

-- End of migration 001
