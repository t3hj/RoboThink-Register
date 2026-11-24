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
SET search_path = public, pg_temp
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
  IF in_result IS NULL OR upper(in_result) NOT IN ('PASS', 'FAIL', 'NOT_FINISHED') THEN
    RAISE EXCEPTION 'Choose Pass, Fail or Not finished';
  END IF;
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
  PERFORM 1 FROM students WHERE id = student FOR UPDATE;
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

  IF upper(in_result) = 'NOT_FINISHED' THEN
    -- Reassessments can close a previous plan without a direct plan link.
    IF EXISTS (SELECT 1 FROM assessments a WHERE a.id = in_assessment_id AND a.attempt_number > 1)
       OR EXISTS (SELECT 1 FROM curriculum_progression_log WHERE assessment_id = in_assessment_id)
       OR EXISTS (SELECT 1 FROM remediation_plans WHERE id = plan_id
                  AND (assessment_id IS DISTINCT FROM in_assessment_id OR lessons_completed > 0)) THEN
      RAISE EXCEPTION 'This attempt has dependent assessment history and cannot be cleared';
    END IF;

    INSERT INTO audit_log(actor_id, action, object_type, object_id, before, after)
    SELECT actor, 'edit_assessment_history', 'assessment', a.id::text, to_jsonb(a),
           jsonb_build_object('session_id', session_id, 'outcome', 'not_finished', 'date', in_date)
    FROM assessments a WHERE a.id = in_assessment_id;

    DELETE FROM remediation_plans WHERE id = plan_id AND assessment_id = in_assessment_id;
    DELETE FROM assessments WHERE id = in_assessment_id;
    UPDATE attended_sessions SET date = in_date, actual_lesson_id = in_assessment_lesson_id,
      outcome = 'not_finished'
    WHERE id = session_id;

    -- Preserve subsequent learning and explicit staff overrides. When this is
    -- the latest activity, the next register should offer the same assessment.
    UPDATE students SET pending_assessment_point_id = NULL
    WHERE id = student AND pending_assessment_point_id = old_point;
    UPDATE students SET current_lesson_id = in_assessment_lesson_id,
                        current_level_id = target_level,
                        pending_assessment_point_id = target_point
    WHERE id = student AND pending_assessment_point_id IS NULL AND override_next_lesson IS NULL
      AND NOT EXISTS (SELECT 1 FROM attended_sessions later JOIN attended_sessions edited ON edited.id = session_id
                      WHERE later.student_id = student AND (later.date, later.session_number) > (edited.date, edited.session_number))
      AND NOT EXISTS (SELECT 1 FROM lesson_records WHERE student_id = student AND date > in_date)
      AND NOT EXISTS (SELECT 1 FROM progress_overrides WHERE student_id = student AND created_at::date >= in_date);
    RETURN;
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

REVOKE ALL ON FUNCTION public.edit_assessment_history(uuid, date, uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.edit_assessment_history(uuid, date, uuid, text, text) TO authenticated, service_role;
