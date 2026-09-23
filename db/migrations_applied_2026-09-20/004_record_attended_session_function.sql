-- Applied directly to the live Supabase project. Final, corrected version
-- (an intermediate attempt hit a Postgres limitation — ON CONFLICT (col)
-- cannot infer a PARTIAL unique index unless the same predicate is
-- repeated in the ON CONFLICT clause — fixed below and verified live
-- against a temporary, fully-cleaned-up test student; see task report).
--
-- The one general entry point for "a student attended a session". Always
-- creates a NEW attended_sessions row (a double session on one date is
-- naturally two rows, session_number 1 and 2). Always upserts
-- lesson_records for the ACTUAL lesson taught (a repeat of an
-- already-completed different lesson is never blocked — the upsert just
-- refreshes that row). Always creates exactly one feedback_sheets row for
-- the session, defaulting to not_written, regardless of outcome.
-- Progression (students.current_lesson_id) is ONLY touched when the
-- outcome is 'completed' AND the actual lesson taught is genuinely the
-- student's current progression lesson.
CREATE OR REPLACE FUNCTION public.record_attended_session(
  in_student_id uuid,
  in_actual_lesson_id uuid,
  in_outcome text,
  in_date date DEFAULT CURRENT_DATE
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
  INSERT INTO attended_sessions (student_id, date, session_number, actual_lesson_id, outcome, instructor_id)
    VALUES (in_student_id, in_date, session_num, in_actual_lesson_id, in_outcome, actor)
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

-- Backward-compatible wrapper: the EXISTING frontend "Mark Done" flow keeps
-- working with zero frontend changes. Same signature, same return value,
-- same behaviour for the common case (completing your own current lesson).
CREATE OR REPLACE FUNCTION public.complete_current_lesson(in_student_id uuid, in_date date DEFAULT CURRENT_DATE)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE current_lesson uuid;
BEGIN
  SELECT current_lesson_id INTO current_lesson FROM students WHERE id = in_student_id;
  IF current_lesson IS NULL THEN RAISE EXCEPTION 'Student has no current lesson'; END IF;
  PERFORM record_attended_session(in_student_id, current_lesson, 'completed', in_date);
  RETURN (SELECT current_lesson_id FROM students WHERE id = in_student_id);
END
$function$;
