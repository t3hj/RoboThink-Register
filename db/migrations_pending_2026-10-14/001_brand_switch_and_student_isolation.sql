-- Separate RoboThink and Creative IQ student records behind an explicit app
-- brand switch. Existing students and staff profiles default to RoboThink.
-- Apply manually after reviewing; the frontend relies on these columns and
-- policies before the Creative IQ workspace can be used.

ALTER TABLE public.students
  ADD COLUMN IF NOT EXISTS brand text NOT NULL DEFAULT 'robothink';
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS active_brand text NOT NULL DEFAULT 'robothink';
ALTER TABLE public.centres
  ADD COLUMN IF NOT EXISTS brand text NOT NULL DEFAULT 'robothink';
CREATE INDEX IF NOT EXISTS centres_brand_idx ON public.centres(brand);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.students'::regclass AND conname='students_brand_allowed') THEN
    ALTER TABLE public.students ADD CONSTRAINT students_brand_allowed CHECK (brand IN ('robothink','creative_iq'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.profiles'::regclass AND conname='profiles_active_brand_allowed') THEN
    ALTER TABLE public.profiles ADD CONSTRAINT profiles_active_brand_allowed CHECK (active_brand IN ('robothink','creative_iq'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.centres'::regclass AND conname='centres_brand_allowed') THEN
    ALTER TABLE public.centres ADD CONSTRAINT centres_brand_allowed CHECK (brand IN ('robothink','creative_iq'));
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.current_app_brand()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public
AS $$ SELECT p.active_brand FROM public.profiles p WHERE p.auth_id=auth.uid() LIMIT 1 $$;
REVOKE ALL ON FUNCTION public.current_app_brand() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_app_brand() TO authenticated, service_role;

-- Centre access is limited to both the active brand and the staff-centre
-- assignment. This keeps the brand switch from widening an instructor's venue access.
CREATE OR REPLACE FUNCTION public.user_centre_ids()
RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT c.id
  FROM public.centres c
  WHERE c.brand=public.current_app_brand()
    AND (public.is_admin() OR EXISTS (
      SELECT 1 FROM public.profiles p
      JOIN public.staff_centres sc ON sc.staff_id=p.id
      WHERE p.auth_id=auth.uid() AND sc.centre_id=c.id
    ));
$$;

CREATE OR REPLACE FUNCTION public.can_access_centre(in_centre uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT in_centre IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.centres c
    WHERE c.id=in_centre AND c.brand=public.current_app_brand()
      AND (public.is_admin() OR EXISTS (
        SELECT 1 FROM public.profiles p
        JOIN public.staff_centres sc ON sc.staff_id=p.id
        WHERE p.auth_id=auth.uid() AND sc.centre_id=c.id
      ))
  );
$$;
REVOKE ALL ON FUNCTION public.user_centre_ids() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_access_centre(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.user_centre_ids() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_access_centre(uuid) TO authenticated, service_role;

DROP POLICY IF EXISTS centres_select_staff ON public.centres;
CREATE POLICY centres_select_staff ON public.centres FOR SELECT
  USING (brand=public.current_app_brand() AND (public.is_admin() OR id IN (SELECT public.user_centre_ids())));
DROP POLICY IF EXISTS centres_admin_write ON public.centres;
CREATE POLICY centres_admin_write ON public.centres FOR ALL
  USING (public.is_admin() AND brand=public.current_app_brand())
  WITH CHECK (public.is_admin() AND brand=public.current_app_brand());
DROP POLICY IF EXISTS staff_centres_admin_all ON public.staff_centres;
CREATE POLICY staff_centres_admin_all ON public.staff_centres FOR ALL
  USING (public.is_admin() AND public.can_access_centre(centre_id))
  WITH CHECK (public.is_admin() AND public.can_access_centre(centre_id));
DROP POLICY IF EXISTS staff_centres_select_own ON public.staff_centres;
CREATE POLICY staff_centres_select_own ON public.staff_centres FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id=staff_centres.staff_id AND p.auth_id=auth.uid()
  ) AND public.can_access_centre(centre_id));

CREATE OR REPLACE FUNCTION public.can_access_student(in_student uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public
AS $$
  SELECT COALESCE((SELECT s.brand=public.current_app_brand() AND CASE
    WHEN s.centre_id IS NULL THEN public.is_admin()
    ELSE public.can_access_centre(s.centre_id) END
    FROM public.students s WHERE s.id=in_student), false);
$$;

-- Admin access and student creation are limited to the selected brand.
DROP POLICY IF EXISTS students_admin_all ON public.students;
CREATE POLICY students_admin_all ON public.students FOR ALL
  USING (public.is_admin() AND brand=public.current_app_brand())
  WITH CHECK (public.is_admin() AND brand=public.current_app_brand());

-- Close admin-only policies that historically bypassed student scoping.
DROP POLICY IF EXISTS assessments_delete_admin ON public.assessments;
CREATE POLICY assessments_delete_admin ON public.assessments FOR DELETE
  USING (public.is_admin() AND public.can_access_student(student_id));
DROP POLICY IF EXISTS attendance_delete_admin ON public.attendance;
CREATE POLICY attendance_delete_admin ON public.attendance FOR DELETE
  USING (public.is_admin() AND public.can_access_student(student_id));
DROP POLICY IF EXISTS lesson_records_delete_admin ON public.lesson_records;
CREATE POLICY lesson_records_delete_admin ON public.lesson_records FOR DELETE
  USING (public.is_admin() AND public.can_access_student(student_id));
DROP POLICY IF EXISTS attended_sessions_delete_admin ON public.attended_sessions;
CREATE POLICY attended_sessions_delete_admin ON public.attended_sessions FOR DELETE
  USING (public.is_admin() AND public.can_access_student(student_id));
DROP POLICY IF EXISTS overrides_admin_only ON public.progress_overrides;
CREATE POLICY overrides_admin_only ON public.progress_overrides FOR ALL
  USING (public.is_admin() AND public.can_access_student(student_id))
  WITH CHECK (public.is_admin() AND public.can_access_student(student_id));
DROP POLICY IF EXISTS student_centre_history_admin_write ON public.student_centre_history;
CREATE POLICY student_centre_history_admin_write ON public.student_centre_history FOR ALL
  USING (public.is_admin() AND public.can_access_student(student_id))
  WITH CHECK (public.is_admin() AND public.can_access_student(student_id));
DROP POLICY IF EXISTS student_centre_history_select_staff ON public.student_centre_history;
CREATE POLICY student_centre_history_select_staff ON public.student_centre_history FOR SELECT
  USING ((public.is_admin() OR public.is_instructor() OR public.is_management())
    AND public.can_access_student(student_id) AND public.can_access_centre(centre_id));
DROP POLICY IF EXISTS term_time_followups_admin_write ON public.term_time_followups;
CREATE POLICY term_time_followups_admin_write ON public.term_time_followups FOR ALL
  USING (public.is_admin() AND public.can_access_student(student_id))
  WITH CHECK (public.is_admin() AND public.can_access_student(student_id));
DROP POLICY IF EXISTS term_time_followups_select ON public.term_time_followups;
CREATE POLICY term_time_followups_select ON public.term_time_followups FOR SELECT
  USING ((public.is_admin() OR public.is_management()) AND public.can_access_student(student_id));

-- Centre snapshots remain intact while read/write requires active-brand access.
DROP POLICY IF EXISTS attendance_insert_staff ON public.attendance;
CREATE POLICY attendance_insert_staff ON public.attendance FOR INSERT WITH CHECK (
  (public.is_admin() OR public.is_instructor())
  AND (instructor_id IS NULL OR instructor_id=(SELECT id FROM public.profiles WHERE auth_id=auth.uid()) OR public.is_admin())
  AND public.can_access_centre(centre_id)
  AND (public.is_admin() OR centre_id=public.current_student_centre(student_id))
  AND public.can_access_student(student_id));
DROP POLICY IF EXISTS attendance_select_staff ON public.attendance;
CREATE POLICY attendance_select_staff ON public.attendance FOR SELECT USING (
  (public.is_admin() OR public.is_instructor() OR public.is_management())
  AND public.can_access_centre(centre_id) AND public.can_access_student(student_id));
DROP POLICY IF EXISTS attendance_update_staff ON public.attendance;
CREATE POLICY attendance_update_staff ON public.attendance FOR UPDATE
  USING ((public.is_admin() OR public.is_instructor())
    AND (instructor_id IS NULL OR instructor_id=(SELECT id FROM public.profiles WHERE auth_id=auth.uid()) OR public.is_admin())
    AND public.can_access_centre(centre_id) AND public.can_access_student(student_id))
  WITH CHECK ((public.is_admin() OR public.is_instructor())
    AND (instructor_id IS NULL OR instructor_id=(SELECT id FROM public.profiles WHERE auth_id=auth.uid()) OR public.is_admin())
    AND public.can_access_centre(centre_id) AND public.can_access_student(student_id));
DROP POLICY IF EXISTS attended_sessions_insert ON public.attended_sessions;
CREATE POLICY attended_sessions_insert ON public.attended_sessions FOR INSERT WITH CHECK (
  (public.is_admin() OR public.is_instructor()) AND public.can_access_centre(centre_id)
  AND (public.is_admin() OR centre_id=public.current_student_centre(student_id))
  AND public.can_access_student(student_id));
DROP POLICY IF EXISTS attended_sessions_select ON public.attended_sessions;
CREATE POLICY attended_sessions_select ON public.attended_sessions FOR SELECT USING (
  (public.is_admin() OR public.is_instructor() OR public.is_management())
  AND public.can_access_centre(centre_id) AND public.can_access_student(student_id));
DROP POLICY IF EXISTS attended_sessions_update ON public.attended_sessions;
CREATE POLICY attended_sessions_update ON public.attended_sessions FOR UPDATE
  USING ((public.is_admin() OR public.is_instructor()) AND public.can_access_centre(centre_id)
    AND public.can_access_student(student_id))
  WITH CHECK ((public.is_admin() OR public.is_instructor()) AND public.can_access_centre(centre_id)
    AND (public.is_admin() OR centre_id=public.current_student_centre(student_id))
    AND public.can_access_student(student_id));

-- This internal SECURITY DEFINER helper is called only by access-checked lesson
-- completion flows. Prevent callers from invoking it with another brand's IDs.
REVOKE EXECUTE ON FUNCTION public.advance_after_completion(uuid, uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.advance_after_completion(uuid, uuid, uuid) FROM anon, authenticated;
-- Protect definer RPCs that validate only by historical centre or directly
-- mutate rows. Service-role maintenance (auth.uid() IS NULL) retains access.
CREATE OR REPLACE FUNCTION public.current_student_centre(in_student uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public
AS $$ SELECT s.centre_id FROM public.students s
  WHERE s.id=in_student AND public.can_access_student(s.id) $$;

CREATE OR REPLACE FUNCTION public.enforce_active_brand_student_write()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.can_access_student(OLD.id) THEN
    RAISE EXCEPTION 'Student is outside the active brand or assigned centres';
  END IF;
  IF auth.uid() IS NOT NULL AND NEW.brand IS DISTINCT FROM public.current_app_brand() THEN
    RAISE EXCEPTION 'Student brand must match the active organisation';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS enforce_active_brand_student_write ON public.students;
CREATE TRIGGER enforce_active_brand_student_write
  BEFORE UPDATE OF brand, centre_id ON public.students
  FOR EACH ROW EXECUTE FUNCTION public.enforce_active_brand_student_write();

CREATE OR REPLACE FUNCTION public.enforce_active_brand_session_write()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;
  IF TG_OP='DELETE' THEN
    IF NOT public.can_access_student(OLD.student_id) THEN
      RAISE EXCEPTION 'Session is outside the active brand or assigned centres';
    END IF;
    RETURN OLD;
  END IF;
  IF NOT public.can_access_student(NEW.student_id) THEN
    RAISE EXCEPTION 'Session is outside the active brand or assigned centres';
  END IF;
  IF TG_OP='UPDATE' AND NOT public.can_access_student(OLD.student_id) THEN
    RAISE EXCEPTION 'Session is outside the active brand or assigned centres';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS enforce_active_brand_session_write ON public.attended_sessions;
CREATE TRIGGER enforce_active_brand_session_write
  BEFORE UPDATE OR DELETE ON public.attended_sessions
  FOR EACH ROW EXECUTE FUNCTION public.enforce_active_brand_session_write();

-- Admin audit rows tied to students follow the same active-brand boundary.
DROP POLICY IF EXISTS audit_log_admin_select ON public.audit_log;
CREATE POLICY audit_log_admin_select ON public.audit_log FOR SELECT
  USING (public.is_admin() AND (
    object_type IS DISTINCT FROM 'student'
    OR EXISTS (
      SELECT 1 FROM public.students s
      WHERE s.id::text = object_id AND public.can_access_student(s.id)
    )
  ));
DROP POLICY IF EXISTS audit_log_admin_insert ON public.audit_log;
CREATE POLICY audit_log_admin_insert ON public.audit_log FOR INSERT
  WITH CHECK (public.is_admin() AND (
    object_type IS DISTINCT FROM 'student'
    OR EXISTS (
      SELECT 1 FROM public.students s
      WHERE s.id::text = object_id AND public.can_access_student(s.id)
    )
  ));