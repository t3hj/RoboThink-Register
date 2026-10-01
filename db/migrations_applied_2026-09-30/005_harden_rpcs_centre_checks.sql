-- Multi-centre Phase 1 — centre-authorisation inside SECURITY DEFINER RPCs.
--
-- These functions bypass RLS (definer), so centre access must be checked in
-- the function body. Each function below is the CURRENT live definition
-- (migrations_applied_2026-09-20/006+007, 2026-09-21/002, 2026-09-15/001)
-- with exactly two kinds of additive change and NO business-logic change:
--   (1) a can_access_student(...) authorisation check at the start (or
--       immediately after the target student/session is resolved), and
--   (2) in record_attended_session, stamping centre_id on the new
--       attended_sessions row = the student's centre AT THAT MOMENT
--       (historical snapshot; never rewritten by later transfers).
--
-- next_curriculum_lesson(lesson_id) is pure curriculum navigation (no student
-- parameter) — it needs no centre check.
-- next_lessons_for_students(ids[]) delegates to compute_next_lesson, whose new
-- access check makes it return NULL rows for inaccessible students (a caller
-- cannot enumerate another centre's next lessons).
--
-- SIGNATURES ARE EXACT AND UNCHANGED. All of these use the exact current
-- parameter names/types from their live definitions, so CREATE OR REPLACE
-- replaces the existing function rather than creating an overload. In
-- particular the 4-arg record_attended_session(uuid,uuid,text,date) was already
-- dropped in 2026-09-20/007 and is NOT recreated here; the 8-arg version is the
-- only one, and complete_current_lesson calls it with all 8 arguments.
--
-- PERMISSIONS: these functions are SECURITY DEFINER and were executable by
-- PUBLIC (PostgreSQL's default), which lets anon call them. The RPCs are not
-- removed or renamed, only re-granted to authenticated + service_role.

-- ------------------------------------------------- compute_next_lesson --------
CREATE OR REPLACE FUNCTION public.compute_next_lesson(in_student uuid)
RETURNS integer
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  lvl int;
  max_completed int := 0;
  override int;
BEGIN
  -- Centre authorisation: an unauthorised caller gets NULL, not the data.
  -- This is what also protects next_lessons_for_students(), which calls this
  -- function for a whole array of ids in one round trip.
  IF NOT public.can_access_student(in_student) THEN
    RETURN NULL;
  END IF;
  SELECT current_level_id INTO lvl FROM students WHERE id = in_student;
  IF lvl IS NULL THEN
    SELECT level_id INTO lvl
    FROM lesson_records
    WHERE student_id = in_student AND status = 'completed'
    ORDER BY date DESC
    LIMIT 1;
  END IF;
  IF lvl IS NULL THEN
    RETURN NULL;
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

-- ------------------------------------------ record_attended_session (8 args) ---
CREATE OR REPLACE FUNCTION public.record_attended_session(
  in_student_id uuid,
  in_actual_lesson_id uuid,
  in_outcome text,
  in_date date DEFAULT CURRENT_DATE,
  in_left_aside boolean DEFAULT false,
  in_left_aside_identifier text DEFAULT NULL,
  in_left_aside_reason text DEFAULT NULL,
  in_left_aside_note text DEFAULT NULL
)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  actor uuid;
  actual_level int;
  actual_num int;
  session_id uuid;
  session_num int;
  lr_id uuid;
  current_lesson uuid;
  current_level int;
  is_progressing boolean;
  nxt uuid;
  pt uuid;
  is_term_time boolean;
  session_centre uuid;
BEGIN
  SELECT id INTO actor FROM profiles WHERE auth_id=auth.uid() AND role IN ('admin','instructor');
  IF actor IS NULL THEN RAISE EXCEPTION 'Staff authentication is required'; END IF;

  -- Centre authorisation (Phase 1): reject cross-centre writes outright.
  IF NOT public.can_access_student(in_student_id) THEN
    RAISE EXCEPTION 'You do not have access to this student''s centre';
  END IF;
  SELECT centre_id INTO session_centre FROM students WHERE id = in_student_id;
  -- A centre-less student is admin-only (see can_access_student), so a
  -- non-admin can only reach this line if their centre assignment changed
  -- mid-request. Rather than insert a centre-less historical row, fail loudly.
  IF session_centre IS NULL THEN
    RAISE EXCEPTION 'Student has no centre assigned';
  END IF;

  IF in_date > CURRENT_DATE THEN RAISE EXCEPTION 'Session date cannot be in the future'; END IF;
  IF in_outcome NOT IN ('completed', 'not_finished') THEN RAISE EXCEPTION 'Invalid outcome'; END IF;
  IF in_left_aside AND (in_left_aside_identifier IS NULL OR in_left_aside_reason IS NULL) THEN
    RAISE EXCEPTION 'An identifier and reason are required when a build/laptop is left aside';
  END IF;
  IF in_left_aside_reason = 'other' AND in_left_aside_note IS NULL THEN
    RAISE EXCEPTION 'A note is required when the reason is Other';
  END IF;
  SELECT level_id, lesson_number INTO actual_level, actual_num
  FROM lessons WHERE id = in_actual_lesson_id AND lesson_kind = 'normal';
  IF actual_level IS NULL THEN RAISE EXCEPTION 'Invalid lesson'; END IF;
  SELECT current_lesson_id, current_level_id INTO current_lesson, current_level
  FROM students WHERE id = in_student_id FOR UPDATE;
  IF current_lesson IS NULL THEN RAISE EXCEPTION 'Student not found'; END IF;
  is_progressing := (in_outcome = 'completed' AND in_actual_lesson_id = current_lesson);
  IF is_progressing AND EXISTS (
    SELECT 1 FROM remediation_plans
    WHERE student_id = in_student_id AND status IN ('required', 'in_progress', 'ready_for_reassessment', 'intervention_required')
  ) THEN
    RAISE EXCEPTION 'Remediation must be resolved first';
  END IF;
  SELECT COALESCE(MAX(session_number), 0) + 1 INTO session_num
    FROM attended_sessions WHERE student_id = in_student_id AND date = in_date;
  INSERT INTO attended_sessions (student_id, date, session_number, actual_lesson_id, outcome, instructor_id, left_aside, left_aside_identifier, left_aside_reason, left_aside_note, centre_id)
    VALUES (in_student_id, in_date, session_num, in_actual_lesson_id, in_outcome, actor, in_left_aside, in_left_aside_identifier, in_left_aside_reason, in_left_aside_note, session_centre)
    RETURNING id INTO session_id;
  INSERT INTO lesson_records (student_id, level_id, lesson_number, lesson_id, date, instructor_id, status)
    VALUES (in_student_id, actual_level, actual_num, in_actual_lesson_id, in_date, actor,
            CASE WHEN in_outcome = 'completed' THEN 'completed' ELSE 'not_completed' END)
    ON CONFLICT (student_id, level_id, lesson_number) DO UPDATE
      SET status = EXCLUDED.status, date = EXCLUDED.date, instructor_id = EXCLUDED.instructor_id, lesson_id = EXCLUDED.lesson_id
    RETURNING id INTO lr_id;
  UPDATE attended_sessions SET lesson_record_id = lr_id WHERE id = session_id;
  INSERT INTO feedback_sheets (attended_session_id, lesson_record_id, student_id, status, created_by, updated_by)
    VALUES (session_id, lr_id, in_student_id, 'not_written', actor, actor)
    ON CONFLICT (attended_session_id) WHERE attended_session_id IS NOT NULL DO NOTHING;
  IF is_progressing THEN
    SELECT EXISTS (
      SELECT 1 FROM students s JOIN subscriptions sub ON sub.id = s.subscription_id
      WHERE s.id = in_student_id AND sub.name = 'Term Time'
    ) INTO is_term_time;
    IF is_term_time AND actual_num % 12 = 0 THEN
      INSERT INTO term_time_followups (student_id, lesson_record_id, lessons_completed_in_block)
        VALUES (in_student_id, lr_id, actual_num)
        ON CONFLICT (lesson_record_id) DO NOTHING;
    END IF;
    SELECT id INTO pt FROM assessment_points WHERE after_lesson_id = current_lesson AND active;
    nxt := next_curriculum_lesson(current_lesson);
    UPDATE students
      SET current_lesson_id = nxt, current_level_id = (SELECT level_id FROM lessons WHERE id = nxt), pending_assessment_point_id = pt
      WHERE id = in_student_id;
  END IF;
  RETURN session_id;
END
$function$;

-- ------------------------------------------------ complete_current_lesson -----
-- Thin backward-compatible wrapper (2026-09-20/007) + centre check.
CREATE OR REPLACE FUNCTION public.complete_current_lesson(in_student_id uuid, in_date date DEFAULT CURRENT_DATE)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE current_lesson uuid;
BEGIN
  IF NOT public.can_access_student(in_student_id) THEN
    RAISE EXCEPTION 'You do not have access to this student''s centre';
  END IF;
  SELECT current_lesson_id INTO current_lesson FROM students WHERE id = in_student_id;
  IF current_lesson IS NULL THEN RAISE EXCEPTION 'Student has no current lesson'; END IF;
  PERFORM record_attended_session(in_student_id, current_lesson, 'completed', in_date, false, NULL, NULL, NULL);
  RETURN (SELECT current_lesson_id FROM students WHERE id = in_student_id);
END
$function$;

-- ------------------------------------------ update_attended_session ------------
CREATE OR REPLACE FUNCTION public.update_attended_session(
  in_session_id uuid,
  in_actual_lesson_id uuid,
  in_outcome text,
  in_left_aside boolean DEFAULT false,
  in_left_aside_identifier text DEFAULT NULL,
  in_left_aside_reason text DEFAULT NULL,
  in_left_aside_note text DEFAULT NULL
)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  actor uuid;
  actual_level int;
  actual_num int;
  student uuid;
  lr_id uuid;
  session_centre uuid;
BEGIN
  SELECT id INTO actor FROM profiles WHERE auth_id = auth.uid() AND role IN ('admin', 'instructor');
  IF actor IS NULL THEN RAISE EXCEPTION 'Staff authentication is required'; END IF;
  IF in_outcome NOT IN ('completed', 'not_finished') THEN RAISE EXCEPTION 'Invalid outcome'; END IF;
  IF in_left_aside AND (in_left_aside_identifier IS NULL OR in_left_aside_reason IS NULL) THEN
    RAISE EXCEPTION 'An identifier and reason are required when a build/laptop is left aside';
  END IF;
  IF in_left_aside_reason = 'other' AND in_left_aside_note IS NULL THEN
    RAISE EXCEPTION 'A note is required when the reason is Other';
  END IF;
  SELECT level_id, lesson_number INTO actual_level, actual_num
  FROM lessons WHERE id = in_actual_lesson_id AND lesson_kind = 'normal';
  IF actual_level IS NULL THEN RAISE EXCEPTION 'Invalid lesson'; END IF;
  SELECT student_id INTO student FROM attended_sessions WHERE id = in_session_id FOR UPDATE;
  IF student IS NULL THEN RAISE EXCEPTION 'Session not found'; END IF;
  -- Centre authorisation: the SESSION's own centre snapshot, NOT the student's
  -- current centre. Correcting a historical session is exactly the case where
  -- the two differ (a student who has since transferred), and the instructor
  -- who taught that session at the old centre must still be able to fix a
  -- typo in it. Gating on the current centre would lock them out of the rows
  -- they legitimately own. The snapshot itself is never changed by this
  -- function, so a session cannot be re-pointed at another centre.
  SELECT centre_id INTO session_centre FROM attended_sessions WHERE id = in_session_id;
  IF NOT public.can_access_centre(session_centre) THEN
    RAISE EXCEPTION 'You do not have access to this session''s centre';
  END IF;
  UPDATE attended_sessions
    SET actual_lesson_id = in_actual_lesson_id, outcome = in_outcome,
        left_aside = in_left_aside, left_aside_identifier = in_left_aside_identifier,
        left_aside_reason = in_left_aside_reason, left_aside_note = in_left_aside_note
    WHERE id = in_session_id;
  INSERT INTO lesson_records (student_id, level_id, lesson_number, lesson_id, date, instructor_id, status)
    SELECT student, actual_level, actual_num, in_actual_lesson_id, date, actor,
           CASE WHEN in_outcome = 'completed' THEN 'completed' ELSE 'not_completed' END
    FROM attended_sessions WHERE id = in_session_id
    ON CONFLICT (student_id, level_id, lesson_number) DO UPDATE
      SET status = EXCLUDED.status, instructor_id = EXCLUDED.instructor_id, lesson_id = EXCLUDED.lesson_id
    RETURNING id INTO lr_id;
  UPDATE attended_sessions SET lesson_record_id = lr_id WHERE id = in_session_id;
END
$function$;

-- ------------------------------------------ set_student_current_lesson --------
CREATE OR REPLACE FUNCTION public.set_student_current_lesson(in_student_id uuid, in_lesson_id uuid, in_reason text)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE actor uuid; old_level int; old_lesson uuid; target_level int;
BEGIN
  SELECT id INTO actor FROM profiles WHERE auth_id=auth.uid() AND role IN ('admin','instructor');
  IF actor IS NULL THEN RAISE EXCEPTION 'Only staff may change a student''s current lesson'; END IF;
  IF COALESCE(trim(in_reason),'')='' THEN RAISE EXCEPTION 'A reason is required'; END IF;
  -- Centre authorisation (Phase 1).
  IF NOT public.can_access_student(in_student_id) THEN
    RAISE EXCEPTION 'You do not have access to this student''s centre';
  END IF;
  SELECT current_level_id,current_lesson_id INTO old_level,old_lesson FROM students WHERE id=in_student_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Student not found'; END IF;
  SELECT level_id INTO target_level FROM lessons WHERE id=in_lesson_id AND lesson_kind='normal';
  IF target_level IS NULL THEN RAISE EXCEPTION 'Invalid lesson'; END IF;
  UPDATE students SET current_level_id=target_level,current_lesson_id=in_lesson_id,pending_assessment_point_id=NULL,override_next_lesson=NULL WHERE id=in_student_id;
  INSERT INTO progress_overrides(student_id,new_lesson,reason,admin_id,previous_level_id,new_level_id,previous_lesson_id,new_lesson_id)
    VALUES(in_student_id,(SELECT lesson_number FROM lessons WHERE id=in_lesson_id),trim(in_reason),actor,old_level,target_level,old_lesson,in_lesson_id);
  INSERT INTO audit_log(actor_id,action,object_type,object_id,before,after)
    VALUES(actor,'set_current_lesson','student',in_student_id::text,jsonb_build_object('level_id',old_level,'lesson_id',old_lesson),jsonb_build_object('level_id',target_level,'lesson_id',in_lesson_id));
END
$function$;

-- ------------------------------------------ record_assessment_result ----------
CREATE OR REPLACE FUNCTION public.record_assessment_result(
  in_student_id uuid,
  in_result text,
  in_date date DEFAULT CURRENT_DATE,
  in_notes text DEFAULT NULL,
  in_attended_session_id uuid DEFAULT NULL,
  in_remediation_path text DEFAULT 'remediation_lessons'
)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE actor uuid; p record; attempt int; assessment uuid; reassessing boolean;
BEGIN
  SELECT id INTO actor FROM profiles WHERE auth_id=auth.uid() AND role IN ('admin','instructor');
  IF actor IS NULL THEN RAISE EXCEPTION 'Staff authentication is required'; END IF;
  IF upper(in_result) NOT IN ('PASS','FAIL') THEN RAISE EXCEPTION 'Assessment result must be PASS or FAIL'; END IF;
  IF upper(in_result)='FAIL' AND in_remediation_path NOT IN ('repeat_next_lesson','remediation_lessons') THEN
    RAISE EXCEPTION 'A remediation path (repeat_next_lesson or remediation_lessons) is required on FAIL';
  END IF;
  -- Centre authorisation (Phase 1).
  IF NOT public.can_access_student(in_student_id) THEN
    RAISE EXCEPTION 'You do not have access to this student''s centre';
  END IF;
  SELECT ap.* INTO p FROM students s JOIN assessment_points ap ON ap.id=s.pending_assessment_point_id WHERE s.id=in_student_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Student has no assessment due'; END IF;
  SELECT COALESCE(max(attempt_number),0)+1 INTO attempt FROM assessments WHERE student_id=in_student_id AND assessment_point_id=p.id;
  SELECT EXISTS(SELECT 1 FROM remediation_plans WHERE student_id=in_student_id AND assessment_point_id=p.id AND status='ready_for_reassessment') INTO reassessing;
  INSERT INTO assessments(student_id,type,date,result,score,instructor_id,notes,attempt_number,passed,remediation_required,level_id,assessment_point_id,attended_session_id)
    VALUES(in_student_id,'curriculum_assessment',in_date,upper(in_result),NULL,actor,in_notes,attempt,upper(in_result)='PASS',upper(in_result)='FAIL',p.level_id,p.id,in_attended_session_id)
    RETURNING id INTO assessment;
  IF upper(in_result)='PASS' THEN
    UPDATE remediation_plans SET status='completed',completed_at=now() WHERE student_id=in_student_id AND assessment_point_id=p.id AND status='ready_for_reassessment';
    UPDATE students SET pending_assessment_point_id=NULL WHERE id=in_student_id;
  ELSIF reassessing THEN
    UPDATE remediation_plans SET status='intervention_required' WHERE student_id=in_student_id AND assessment_point_id=p.id AND status='ready_for_reassessment';
  ELSIF in_remediation_path = 'repeat_next_lesson' THEN
    INSERT INTO remediation_plans(student_id,level_id,assessment_id,assessment_point_id,topic,lessons_required,lessons_completed,status,remediation_path)
      VALUES(in_student_id,p.level_id,assessment,p.id,p.focus_topic,0,0,'ready_for_reassessment','repeat_next_lesson');
  ELSE
    INSERT INTO remediation_plans(student_id,level_id,assessment_id,assessment_point_id,topic,lessons_required,lessons_completed,status,remediation_path)
      VALUES(in_student_id,p.level_id,assessment,p.id,p.focus_topic,3,0,'required','remediation_lessons');
  END IF;
END
$function$;

-- ------------------------------------------ complete_remediation_lesson -------
CREATE OR REPLACE FUNCTION public.complete_remediation_lesson(
  in_student_id uuid,
  in_date date DEFAULT CURRENT_DATE,
  in_notes text DEFAULT NULL,
  in_attended_session_id uuid DEFAULT NULL
)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE actor uuid; p record; n int;
BEGIN
  SELECT id INTO actor FROM profiles WHERE auth_id=auth.uid() AND role IN ('admin','instructor');
  IF actor IS NULL THEN RAISE EXCEPTION 'Staff authentication is required'; END IF;
  -- Centre authorisation (Phase 1).
  IF NOT public.can_access_student(in_student_id) THEN
    RAISE EXCEPTION 'You do not have access to this student''s centre';
  END IF;
  SELECT * INTO p FROM remediation_plans WHERE student_id=in_student_id AND status IN ('required','in_progress') ORDER BY created_at DESC LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No active remediation plan'; END IF;
  n:=p.lessons_completed+1;
  INSERT INTO remediation_lessons(remediation_plan_id,student_id,level_id,lesson_number,date,topic,notes,instructor_id,status,attended_session_id)
    VALUES(p.id,in_student_id,p.level_id,n,in_date,p.topic,in_notes,actor,'completed',in_attended_session_id);
  UPDATE remediation_plans SET lessons_completed=n,status=CASE WHEN n>=lessons_required THEN 'ready_for_reassessment' ELSE 'in_progress' END,completed_at=CASE WHEN n>=lessons_required THEN now() ELSE NULL END WHERE id=p.id;
  RETURN n;
END
$function$;
-- ------------------------------------------ privilege lockdown ------------------
-- Every function above is SECURITY DEFINER and, by PostgreSQL's default,
-- EXECUTE is granted to PUBLIC — which includes the anon role. Each already
-- performs its own role check inside the body, so this is defence in depth
-- rather than the primary control, but anon should not be able to invoke staff
-- RPCs at all. service_role keeps access for server-side/admin scripts.
REVOKE ALL ON FUNCTION public.record_attended_session(uuid, uuid, text, date, boolean, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_attended_session(uuid, uuid, text, boolean, text, text, text)     FROM PUBLIC;
REVOKE ALL ON FUNCTION public.complete_current_lesson(uuid, date)                                     FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_student_current_lesson(uuid, uuid, text)                            FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_assessment_result(uuid, text, date, text, uuid, text)            FROM PUBLIC;
REVOKE ALL ON FUNCTION public.complete_remediation_lesson(uuid, date, text, uuid)                     FROM PUBLIC;
REVOKE ALL ON FUNCTION public.compute_next_lesson(uuid)                                               FROM PUBLIC;
REVOKE ALL ON FUNCTION public.next_lessons_for_students(uuid[])                                       FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.record_attended_session(uuid, uuid, text, date, boolean, text, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.update_attended_session(uuid, uuid, text, boolean, text, text, text)     TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.complete_current_lesson(uuid, date)                                     TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_student_current_lesson(uuid, uuid, text)                            TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_assessment_result(uuid, text, date, text, uuid, text)            TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.complete_remediation_lesson(uuid, date, text, uuid)                     TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.compute_next_lesson(uuid)                                               TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.next_lessons_for_students(uuid[])                                       TO authenticated, service_role;

-- Guard against signature drift: if any of these names exists with a different
-- argument list than the definitions above, CREATE OR REPLACE would have
-- silently created an extra overload rather than replacing the live one.
-- Run this AFTER the definitions above; it should always return zero rows.
--
--   SELECT p.proname, pg_get_function_identity_arguments(p.oid)
--   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--   WHERE n.nspname = 'public'
--     AND p.proname IN (
--       'record_attended_session','update_attended_session',
--       'complete_current_lesson','set_student_current_lesson',
--       'record_assessment_result','complete_remediation_lesson',
--       'compute_next_lesson','next_lessons_for_students')
--   ORDER BY p.proname, 2;
--
-- Expected: one row per function name (two for record_attended_session /
-- complete_current_lesson only if the pre-2026-09-20 overloads ever return).