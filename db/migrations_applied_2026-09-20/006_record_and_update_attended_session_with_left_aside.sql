-- Applied directly to the live Supabase project (bvbrafmazxrfiaocqdjg).
-- Extends record_attended_session with optional left-aside details
-- (defaulted, so any existing 4-arg caller keeps working — though see the
-- note on overloads below). Adds update_attended_session so an instructor
-- can reopen and correct an EXISTING session without duplicating it.
-- Verified live end-to-end (not_finished + left_aside, then edited via
-- update_attended_session -> confirmed still exactly one session row, one
-- feedback row, updated fields) against a temporary, fully-deleted test
-- student. See task report for details.

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
BEGIN
  SELECT id INTO actor FROM profiles WHERE auth_id = auth.uid() AND role IN ('admin', 'instructor');
  IF actor IS NULL THEN RAISE EXCEPTION 'Staff authentication is required'; END IF;
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
  INSERT INTO attended_sessions (student_id, date, session_number, actual_lesson_id, outcome, instructor_id, left_aside, left_aside_identifier, left_aside_reason, left_aside_note)
    VALUES (in_student_id, in_date, session_num, in_actual_lesson_id, in_outcome, actor, in_left_aside, in_left_aside_identifier, in_left_aside_reason, in_left_aside_note)
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

-- Lets an instructor reopen and correct an EXISTING session without
-- creating a duplicate. Deliberately conservative: updates the session +
-- its lesson_records row only. It NEVER touches progression — not on the
-- way in, not retroactively — so correcting a session can't accidentally
-- advance or rewind a student's current lesson.
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
