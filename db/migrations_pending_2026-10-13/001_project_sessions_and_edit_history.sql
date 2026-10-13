-- Projects are sessions in their own right and do not advance curriculum lessons.
ALTER TABLE public.attended_sessions
  ALTER COLUMN actual_lesson_id DROP NOT NULL;

ALTER TABLE public.attended_sessions
  ADD CONSTRAINT attended_sessions_activity_present
  CHECK (actual_lesson_id IS NOT NULL OR project_id IS NOT NULL);

CREATE OR REPLACE FUNCTION public.record_project_session(
  in_student_id uuid,
  in_project_id uuid,
  in_outcome text,
  in_date date DEFAULT CURRENT_DATE
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor uuid;
  session_centre uuid;
  session_id uuid;
  session_num int;
BEGIN
  SELECT id INTO actor FROM profiles
  WHERE auth_id = auth.uid() AND role IN ('admin', 'instructor');
  IF actor IS NULL THEN RAISE EXCEPTION 'Staff authentication is required'; END IF;
  IF NOT public.can_access_student(in_student_id) THEN
    RAISE EXCEPTION 'You do not have access to this student''s centre';
  END IF;
  IF in_date > CURRENT_DATE THEN RAISE EXCEPTION 'Session date cannot be in the future'; END IF;
  IF in_outcome NOT IN ('completed', 'not_finished') THEN RAISE EXCEPTION 'Invalid outcome'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM student_projects
    WHERE id = in_project_id AND student_id = in_student_id AND status = 'active'
  ) THEN RAISE EXCEPTION 'Choose an active project for this student'; END IF;
  SELECT centre_id INTO session_centre FROM students WHERE id = in_student_id;
  IF session_centre IS NULL THEN RAISE EXCEPTION 'Student has no centre assigned'; END IF;
  SELECT COALESCE(MAX(session_number), 0) + 1 INTO session_num
    FROM attended_sessions WHERE student_id = in_student_id AND date = in_date;
  INSERT INTO attended_sessions (student_id, date, session_number, actual_lesson_id, project_id, outcome, instructor_id, centre_id)
    VALUES (in_student_id, in_date, session_num, NULL, in_project_id, in_outcome, actor, session_centre)
    RETURNING id INTO session_id;
  INSERT INTO feedback_sheets (attended_session_id, student_id, status, created_by, updated_by)
    VALUES (session_id, in_student_id, 'not_written', actor, actor)
    ON CONFLICT (attended_session_id) WHERE attended_session_id IS NOT NULL DO NOTHING;
  RETURN session_id;
END
$$;

CREATE OR REPLACE FUNCTION public.update_lesson_history(
  in_lesson_record_id uuid,
  in_date date,
  in_lesson_id uuid,
  in_outcome text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor uuid;
  student uuid;
  session_id uuid;
  session_centre uuid;
  target_level int;
  target_number int;
BEGIN
  SELECT id INTO actor FROM profiles
  WHERE auth_id = auth.uid() AND role IN ('admin', 'instructor');
  IF actor IS NULL THEN RAISE EXCEPTION 'Staff authentication is required'; END IF;
  IF in_date > CURRENT_DATE THEN RAISE EXCEPTION 'Lesson date cannot be in the future'; END IF;
  IF in_outcome NOT IN ('completed', 'not_finished') THEN RAISE EXCEPTION 'Invalid outcome'; END IF;
  SELECT level_id, lesson_number INTO target_level, target_number
  FROM lessons WHERE id = in_lesson_id AND lesson_kind = 'normal';
  IF target_level IS NULL THEN RAISE EXCEPTION 'Choose a valid normal lesson'; END IF;
  SELECT student_id INTO student FROM lesson_records WHERE id = in_lesson_record_id FOR UPDATE;
  IF student IS NULL THEN RAISE EXCEPTION 'Lesson history entry not found'; END IF;
  IF NOT public.can_access_student(student) THEN
    RAISE EXCEPTION 'You do not have access to this student''s centre';
  END IF;
  SELECT id, centre_id INTO session_id, session_centre
  FROM attended_sessions WHERE lesson_record_id = in_lesson_record_id FOR UPDATE;
  IF session_id IS NOT NULL AND NOT public.can_access_centre(session_centre) THEN
    RAISE EXCEPTION 'You do not have access to this session''s centre';
  END IF;
  UPDATE lesson_records
    SET date = in_date, level_id = target_level, lesson_number = target_number,
        lesson_id = in_lesson_id,
        status = CASE WHEN in_outcome = 'completed' THEN 'completed' ELSE 'not_completed' END
    WHERE id = in_lesson_record_id;
  IF session_id IS NOT NULL THEN
    UPDATE attended_sessions
      SET date = in_date, actual_lesson_id = in_lesson_id, outcome = in_outcome
      WHERE id = session_id;
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION public.update_project_session(
  in_session_id uuid,
  in_project_id uuid,
  in_outcome text,
  in_date date
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor uuid;
  student uuid;
  session_centre uuid;
  old_record_id uuid;
BEGIN
  SELECT id INTO actor FROM profiles
  WHERE auth_id = auth.uid() AND role IN ('admin', 'instructor');
  IF actor IS NULL THEN RAISE EXCEPTION 'Staff authentication is required'; END IF;
  IF in_date > CURRENT_DATE THEN RAISE EXCEPTION 'Session date cannot be in the future'; END IF;
  IF in_outcome NOT IN ('completed', 'not_finished') THEN RAISE EXCEPTION 'Invalid outcome'; END IF;
  SELECT student_id, centre_id, lesson_record_id INTO student, session_centre, old_record_id
  FROM attended_sessions WHERE id = in_session_id AND project_id IS NOT NULL FOR UPDATE;
  IF student IS NULL THEN RAISE EXCEPTION 'Project session not found'; END IF;
  IF NOT public.can_access_centre(session_centre) THEN
    RAISE EXCEPTION 'You do not have access to this session''s centre';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM student_projects WHERE id = in_project_id AND student_id = student AND status = 'active') THEN
    RAISE EXCEPTION 'Choose an active project for this student';
  END IF;
  IF old_record_id IS NOT NULL THEN
    UPDATE feedback_sheets SET lesson_record_id = NULL WHERE attended_session_id = in_session_id;
  END IF;
  UPDATE attended_sessions
    SET project_id = in_project_id, actual_lesson_id = NULL, lesson_record_id = NULL, outcome = in_outcome, date = in_date
    WHERE id = in_session_id;
  IF old_record_id IS NOT NULL THEN
    DELETE FROM lesson_records lr WHERE lr.id = old_record_id
      AND NOT EXISTS (SELECT 1 FROM attended_sessions other WHERE other.lesson_record_id = lr.id)
      AND NOT EXISTS (SELECT 1 FROM term_time_followups followup WHERE followup.lesson_record_id = lr.id);
  END IF;
END
$$;

REVOKE ALL ON FUNCTION public.record_project_session(uuid, uuid, text, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_project_session(uuid, uuid, text, date) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.update_project_session(uuid, uuid, text, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_project_session(uuid, uuid, text, date) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.update_lesson_history(uuid, date, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_lesson_history(uuid, date, uuid, text) TO authenticated, service_role;
