-- Convert a normal lesson-history entry into a curriculum assessment attempt.
CREATE OR REPLACE FUNCTION public.convert_lesson_history_to_assessment(
  in_lesson_record_id uuid,
  in_date date,
  in_assessment_lesson_id uuid,
  in_result text,
  in_remediation_path text DEFAULT 'remediation_lessons'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor uuid;
  student uuid;
  centre uuid;
  session_id uuid;
  session_num integer;
  point_id uuid;
  point_topic text;
  lesson_level integer;
  assessment_attempt integer;
  assessment_id uuid;
  current_pending_point uuid;
BEGIN
  SELECT id INTO actor FROM profiles
  WHERE auth_id = auth.uid() AND role IN ('admin', 'instructor');
  IF actor IS NULL THEN RAISE EXCEPTION 'Staff authentication is required'; END IF;
  IF in_date > CURRENT_DATE THEN RAISE EXCEPTION 'Assessment date cannot be in the future'; END IF;
  IF upper(in_result) NOT IN ('PASS', 'FAIL', 'NOT_FINISHED') THEN
    RAISE EXCEPTION 'Assessment result must be PASS, FAIL, or NOT_FINISHED';
  END IF;
  IF upper(in_result) = 'FAIL' AND in_remediation_path NOT IN ('repeat_next_lesson', 'remediation_lessons') THEN
    RAISE EXCEPTION 'Choose a remediation path for a failed assessment';
  END IF;

  SELECT lr.student_id INTO student
  FROM lesson_records lr WHERE lr.id = in_lesson_record_id FOR UPDATE;
  IF student IS NULL THEN RAISE EXCEPTION 'Lesson history entry not found'; END IF;
  IF NOT public.can_access_student(student) THEN
    RAISE EXCEPTION 'You do not have access to this student''s centre';
  END IF;
  IF EXISTS (SELECT 1 FROM term_time_followups WHERE lesson_record_id = in_lesson_record_id) THEN
    RAISE EXCEPTION 'This lesson is used by a term follow-up and cannot be converted';
  END IF;
  SELECT s.centre_id INTO centre FROM students s WHERE s.id = student;
  IF centre IS NULL THEN RAISE EXCEPTION 'Student has no centre assigned'; END IF;

  SELECT ap.id, ap.focus_topic, le.level_id
    INTO point_id, point_topic, lesson_level
  FROM lessons le
  JOIN assessment_points ap ON ap.after_lesson_id = le.id AND ap.active
  WHERE le.id = in_assessment_lesson_id AND le.assessment_required;
  IF point_id IS NULL THEN RAISE EXCEPTION 'Choose an active curriculum assessment'; END IF;

  SELECT id INTO session_id FROM attended_sessions
  WHERE lesson_record_id = in_lesson_record_id FOR UPDATE;
  IF session_id IS NOT NULL AND EXISTS (SELECT 1 FROM assessments WHERE attended_session_id = session_id) THEN
    RAISE EXCEPTION 'This session already has an assessment record';
  END IF;
  IF session_id IS NULL THEN
    SELECT COALESCE(MAX(session_number), 0) + 1 INTO session_num
    FROM attended_sessions WHERE student_id = student AND date = in_date;
    INSERT INTO attended_sessions (student_id, date, session_number, actual_lesson_id, outcome, instructor_id, centre_id)
    VALUES (student, in_date, session_num, in_assessment_lesson_id, 'not_finished', actor, centre)
    RETURNING id INTO session_id;
  END IF;

  IF upper(in_result) IN ('PASS', 'FAIL') THEN
    SELECT COALESCE(MAX(attempt_number), 0) + 1 INTO assessment_attempt
    FROM assessments WHERE student_id = student AND assessment_point_id = point_id;
    INSERT INTO assessments (
      student_id, type, date, result, score, instructor_id, notes, attempt_number,
      passed, remediation_required, level_id, assessment_point_id, attended_session_id
    ) VALUES (
      student, 'curriculum_assessment', in_date, upper(in_result), NULL, actor, NULL,
      assessment_attempt, upper(in_result) = 'PASS', upper(in_result) = 'FAIL',
      lesson_level, point_id, session_id
    ) RETURNING id INTO assessment_id;

    IF upper(in_result) = 'FAIL' THEN
      SELECT pending_assessment_point_id INTO current_pending_point
      FROM students WHERE id = student FOR UPDATE;
      IF current_pending_point IS NOT NULL AND current_pending_point <> point_id THEN
        RAISE EXCEPTION 'Resolve the student''s currently due assessment before starting another remediation plan';
      END IF;
      IF EXISTS (
        SELECT 1 FROM remediation_plans
        WHERE student_id = student
          AND status IN ('required', 'in_progress', 'ready_for_reassessment', 'intervention_required')
          AND assessment_point_id IS DISTINCT FROM point_id
      ) THEN
        RAISE EXCEPTION 'Resolve the student''s other assessment follow-up before recording this failure';
      END IF;
      INSERT INTO remediation_plans (
        student_id, level_id, assessment_id, assessment_point_id, topic,
        lessons_required, lessons_completed, status, remediation_path
      ) VALUES (
        student, lesson_level, assessment_id, point_id, point_topic,
        CASE WHEN in_remediation_path = 'repeat_next_lesson' THEN 0 ELSE 3 END,
        0,
        CASE WHEN in_remediation_path = 'repeat_next_lesson' THEN 'ready_for_reassessment' ELSE 'required' END,
        in_remediation_path
      );
      UPDATE students SET pending_assessment_point_id = point_id WHERE id = student;
    END IF;
  END IF;

  UPDATE feedback_sheets fs
  SET lesson_record_id = NULL,
      attended_session_id = CASE
        WHEN fs.attended_session_id IS NULL
          AND NOT EXISTS (SELECT 1 FROM feedback_sheets existing WHERE existing.attended_session_id = session_id)
        THEN session_id ELSE fs.attended_session_id END
  WHERE fs.lesson_record_id = in_lesson_record_id;
  UPDATE attended_sessions
  SET date = in_date, actual_lesson_id = in_assessment_lesson_id,
      lesson_record_id = NULL,
      outcome = CASE WHEN upper(in_result) = 'NOT_FINISHED' THEN 'not_finished' ELSE 'completed' END
  WHERE id = session_id;
  DELETE FROM lesson_records WHERE id = in_lesson_record_id;

  INSERT INTO feedback_sheets (attended_session_id, student_id, status, created_by, updated_by)
  SELECT session_id, student, 'not_written', actor, actor
  WHERE NOT EXISTS (SELECT 1 FROM feedback_sheets WHERE attended_session_id = session_id)
  ON CONFLICT (attended_session_id) WHERE attended_session_id IS NOT NULL DO NOTHING;
  RETURN session_id;
END
$$;

-- Correct a curriculum assessment only while no later assessment or remediation
-- session depends on it. The linked session and remediation plan are updated atomically.
CREATE OR REPLACE FUNCTION public.edit_assessment_history(
  in_assessment_id uuid,
  in_date date,
  in_assessment_lesson_id uuid,
  in_result text,
  in_remediation_path text DEFAULT 'remediation_lessons'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor uuid;
  student uuid;
  centre uuid;
  session_id uuid;
  old_point uuid;
  target_point uuid;
  target_topic text;
  target_level integer;
  plan_id uuid;
  plan_status text;
  attempt integer;
  current_pending_point uuid;
BEGIN
  SELECT id INTO actor FROM profiles
  WHERE auth_id = auth.uid() AND role IN ('admin', 'instructor');
  IF actor IS NULL THEN RAISE EXCEPTION 'Staff authentication is required'; END IF;
  IF in_date > CURRENT_DATE THEN RAISE EXCEPTION 'Assessment date cannot be in the future'; END IF;
  IF upper(in_result) NOT IN ('PASS', 'FAIL') THEN RAISE EXCEPTION 'Choose PASS or FAIL'; END IF;
  IF upper(in_result) = 'FAIL' AND in_remediation_path NOT IN ('repeat_next_lesson', 'remediation_lessons') THEN
    RAISE EXCEPTION 'Choose a remediation path for a failed assessment';
  END IF;

  SELECT a.student_id, a.attended_session_id, a.assessment_point_id
    INTO student, session_id, old_point
  FROM assessments a WHERE a.id = in_assessment_id AND a.type = 'curriculum_assessment' FOR UPDATE;
  IF student IS NULL OR session_id IS NULL THEN
    RAISE EXCEPTION 'Only linked curriculum assessment sessions can be edited here';
  END IF;
  IF NOT public.can_access_student(student) THEN
    RAISE EXCEPTION 'You do not have access to this student''s centre';
  END IF;
  SELECT centre_id INTO centre FROM attended_sessions WHERE id = session_id FOR UPDATE;
  IF NOT public.can_access_centre(centre) THEN
    RAISE EXCEPTION 'You do not have access to this session''s centre';
  END IF;
  IF EXISTS (
    SELECT 1 FROM assessments other
    WHERE other.student_id = student AND other.id <> in_assessment_id
      AND (other.date > (SELECT date FROM assessments WHERE id = in_assessment_id)
        OR (other.date = (SELECT date FROM assessments WHERE id = in_assessment_id)
          AND other.created_at > (SELECT created_at FROM assessments WHERE id = in_assessment_id)))
  ) THEN
    RAISE EXCEPTION 'Only the latest assessment can be corrected; later assessment attempts depend on this history';
  END IF;

  SELECT ap.id, ap.focus_topic, le.level_id INTO target_point, target_topic, target_level
  FROM lessons le JOIN assessment_points ap ON ap.after_lesson_id = le.id AND ap.active
  WHERE le.id = in_assessment_lesson_id AND le.assessment_required;
  IF target_point IS NULL THEN RAISE EXCEPTION 'Choose an active curriculum assessment'; END IF;

  SELECT rp.id, rp.status INTO plan_id, plan_status
  FROM remediation_plans rp
  WHERE rp.assessment_id = in_assessment_id
     OR rp.id = (SELECT a.remediation_plan_id FROM assessments a WHERE a.id = in_assessment_id)
  ORDER BY (rp.assessment_id = in_assessment_id) DESC
  LIMIT 1 FOR UPDATE;

  IF plan_id IS NOT NULL AND (
    plan_status IN ('completed', 'intervention_required')
    OR EXISTS (SELECT 1 FROM remediation_lessons WHERE remediation_plan_id = plan_id)
  ) THEN
    RAISE EXCEPTION 'This assessment already has remediation history; edit is blocked to preserve that follow-up';
  END IF;
  IF EXISTS (
    SELECT 1 FROM remediation_plans rp
    WHERE rp.student_id = student AND rp.id IS DISTINCT FROM plan_id
      AND rp.assessment_point_id = target_point
      AND rp.status IN ('required', 'in_progress', 'ready_for_reassessment', 'intervention_required')
  ) THEN
    RAISE EXCEPTION 'Another active follow-up already uses this assessment point';
  END IF;

  IF target_point IS DISTINCT FROM old_point THEN
    SELECT COALESCE(MAX(attempt_number), 0) + 1 INTO attempt
    FROM assessments WHERE student_id = student AND assessment_point_id = target_point AND id <> in_assessment_id;
  ELSE
    SELECT attempt_number INTO attempt FROM assessments WHERE id = in_assessment_id;
  END IF;

  UPDATE assessments SET
    date = in_date,
    result = upper(in_result),
    passed = (upper(in_result) = 'PASS'),
    remediation_required = (upper(in_result) = 'FAIL'),
    level_id = target_level,
    assessment_point_id = target_point,
    attempt_number = attempt
  WHERE id = in_assessment_id;

  IF upper(in_result) = 'FAIL' THEN
    SELECT pending_assessment_point_id INTO current_pending_point
    FROM students WHERE id = student FOR UPDATE;
    IF current_pending_point IS NOT NULL AND current_pending_point IS DISTINCT FROM old_point AND current_pending_point IS DISTINCT FROM target_point THEN
      RAISE EXCEPTION 'Resolve the student''s currently due assessment before changing this result to FAIL';
    END IF;
    IF plan_id IS NULL THEN
      INSERT INTO remediation_plans (
        student_id, level_id, assessment_id, assessment_point_id, topic,
        lessons_required, lessons_completed, status, remediation_path
      ) VALUES (
        student, target_level, in_assessment_id, target_point, target_topic,
        CASE WHEN in_remediation_path = 'repeat_next_lesson' THEN 0 ELSE 3 END,
        0,
        CASE WHEN in_remediation_path = 'repeat_next_lesson' THEN 'ready_for_reassessment' ELSE 'required' END,
        in_remediation_path
      ) RETURNING id INTO plan_id;
    ELSE
      UPDATE remediation_plans SET
        level_id = target_level, assessment_point_id = target_point, topic = target_topic,
        lessons_required = CASE WHEN in_remediation_path = 'repeat_next_lesson' THEN 0 ELSE 3 END,
        status = CASE WHEN in_remediation_path = 'repeat_next_lesson' THEN 'ready_for_reassessment' ELSE 'required' END,
        remediation_path = in_remediation_path,
        completed_at = NULL
      WHERE id = plan_id;
    END IF;
    UPDATE assessments SET remediation_plan_id = plan_id WHERE id = in_assessment_id;
    UPDATE students SET pending_assessment_point_id = target_point WHERE id = student;
  ELSE
    IF plan_id IS NOT NULL THEN
      DELETE FROM remediation_plans WHERE id = plan_id;
    END IF;
    UPDATE assessments SET remediation_plan_id = NULL WHERE id = in_assessment_id;
    UPDATE students SET pending_assessment_point_id = NULL
    WHERE id = student AND pending_assessment_point_id = old_point;
  END IF;

  UPDATE attended_sessions SET date = in_date, actual_lesson_id = in_assessment_lesson_id, outcome = 'completed'
  WHERE id = session_id;
END
$$;

REVOKE ALL ON FUNCTION public.convert_lesson_history_to_assessment(uuid, date, uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.convert_lesson_history_to_assessment(uuid, date, uuid, text, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.edit_assessment_history(uuid, date, uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.edit_assessment_history(uuid, date, uuid, text, text) TO authenticated, service_role;
