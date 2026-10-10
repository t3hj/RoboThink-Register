-- Pending migration: make every curriculum assessment explicit, including
-- Robotics Assessment 1/2 lessons that remain normal progression lessons.

ALTER TABLE public.lessons
  ADD COLUMN IF NOT EXISTS assessment_required boolean NOT NULL DEFAULT false;

UPDATE public.lessons
SET assessment_required = true
WHERE lesson_kind = 'assessment'
   OR title ~* '^assessment(\s|$)';

-- Every selectable assessment needs a point so FAIL follows the same
-- remediation/reassessment workflow, including Robotics Assessment 1.
INSERT INTO public.assessment_points AS existing_point (level_id, after_lesson_id, focus_topic, active)
SELECT le.level_id, le.id, COALESCE(NULLIF(le.focus_topic, ''), le.title), true
FROM public.lessons le
WHERE le.assessment_required
ON CONFLICT (after_lesson_id) DO UPDATE
  SET active = true,
      focus_topic = COALESCE(NULLIF(existing_point.focus_topic, ''), EXCLUDED.focus_topic);

CREATE OR REPLACE FUNCTION public.record_assessment_lesson_session(
  in_student_id uuid,
  in_assessment_lesson_id uuid,
  in_date date,
  in_result text,
  in_remediation_path text DEFAULT 'remediation_lessons'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  actor uuid;
  lesson_level integer;
  point_id uuid;
  point_topic text;
  current_pending_point uuid;
  session_id uuid;
  session_num integer;
  attempt integer;
  assessment_id uuid;
  reassessing boolean;
  other_active_plan boolean;
BEGIN
  SELECT id INTO actor
  FROM profiles
  WHERE auth_id = auth.uid() AND role IN ('admin', 'instructor');
  IF actor IS NULL THEN RAISE EXCEPTION 'Staff authentication is required'; END IF;
  IF NOT public.can_access_student(in_student_id) THEN
    RAISE EXCEPTION 'You do not have access to this student''s centre';
  END IF;
  IF in_date > CURRENT_DATE THEN RAISE EXCEPTION 'Session date cannot be in the future'; END IF;
  IF in_result IS NULL OR upper(in_result) NOT IN ('PASS', 'FAIL') THEN
    RAISE EXCEPTION 'Assessment result must be PASS or FAIL';
  END IF;
  IF upper(in_result) = 'FAIL'
     AND in_remediation_path NOT IN ('repeat_next_lesson', 'remediation_lessons') THEN
    RAISE EXCEPTION 'A remediation path (repeat_next_lesson or remediation_lessons) is required on FAIL';
  END IF;

  SELECT le.level_id, ap.id, ap.focus_topic
  INTO lesson_level, point_id, point_topic
  FROM lessons le
  JOIN assessment_points ap ON ap.after_lesson_id = le.id AND ap.active
  WHERE le.id = in_assessment_lesson_id
    AND le.assessment_required;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'This assessment lesson is not configured for PASS/FAIL recording';
  END IF;

  SELECT pending_assessment_point_id INTO current_pending_point
  FROM students
  WHERE id = in_student_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Student not found'; END IF;

  SELECT EXISTS (
    SELECT 1 FROM remediation_plans
    WHERE student_id = in_student_id
      AND assessment_point_id = point_id
      AND status IN ('required', 'in_progress')
  ) INTO other_active_plan;
  IF other_active_plan THEN
    RAISE EXCEPTION 'Complete the remediation lessons for this assessment before reassessing';
  END IF;
  IF EXISTS (
    SELECT 1 FROM remediation_plans
    WHERE student_id = in_student_id
      AND assessment_point_id = point_id
      AND status = 'intervention_required'
  ) THEN
    RAISE EXCEPTION 'This assessment needs manual follow-up before another attempt can be recorded';
  END IF;

  IF upper(in_result) = 'FAIL' AND current_pending_point IS NOT NULL AND current_pending_point <> point_id THEN
    RAISE EXCEPTION 'Resolve the student''s currently due assessment before starting another remediation plan';
  END IF;

  IF upper(in_result) = 'FAIL' AND EXISTS (
    SELECT 1 FROM remediation_plans
    WHERE student_id = in_student_id
      AND status IN ('required', 'in_progress', 'ready_for_reassessment', 'intervention_required')
      AND assessment_point_id IS DISTINCT FROM point_id
  ) THEN
    RAISE EXCEPTION 'Resolve the student''s other assessment follow-up before starting another remediation plan';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM remediation_plans
    WHERE student_id = in_student_id
      AND assessment_point_id = point_id
      AND status = 'ready_for_reassessment'
  ) INTO reassessing;

  SELECT COALESCE(MAX(session_number), 0) + 1 INTO session_num
  FROM attended_sessions
  WHERE student_id = in_student_id AND date = in_date;
  INSERT INTO attended_sessions (student_id, date, session_number, actual_lesson_id, outcome, instructor_id)
  VALUES (in_student_id, in_date, session_num, in_assessment_lesson_id, 'completed', actor)
  RETURNING id INTO session_id;

  SELECT COALESCE(MAX(attempt_number), 0) + 1 INTO attempt
  FROM assessments
  WHERE student_id = in_student_id AND assessment_point_id = point_id;
  INSERT INTO assessments (
    student_id, type, date, result, score, instructor_id, notes, attempt_number,
    passed, remediation_required, level_id, assessment_point_id, attended_session_id
  ) VALUES (
    in_student_id, 'curriculum_assessment', in_date, upper(in_result), NULL,
    actor, NULL, attempt, upper(in_result) = 'PASS', upper(in_result) = 'FAIL',
    lesson_level, point_id, session_id
  ) RETURNING id INTO assessment_id;

  IF upper(in_result) = 'PASS' THEN
    UPDATE remediation_plans
      SET status = 'completed', completed_at = now()
      WHERE student_id = in_student_id
        AND assessment_point_id = point_id
        AND status = 'ready_for_reassessment';
    UPDATE students SET pending_assessment_point_id = NULL
      WHERE id = in_student_id AND pending_assessment_point_id = point_id;
  ELSIF reassessing THEN
    UPDATE remediation_plans SET status = 'intervention_required'
      WHERE student_id = in_student_id
        AND assessment_point_id = point_id
        AND status = 'ready_for_reassessment';
  ELSE
    INSERT INTO remediation_plans (
      student_id, level_id, assessment_id, assessment_point_id, topic,
      lessons_required, lessons_completed, status, remediation_path
    ) VALUES (
      in_student_id, lesson_level,
      assessment_id,
      point_id, point_topic,
      CASE WHEN in_remediation_path = 'repeat_next_lesson' THEN 0 ELSE 3 END,
      0,
      CASE WHEN in_remediation_path = 'repeat_next_lesson' THEN 'ready_for_reassessment' ELSE 'required' END,
      in_remediation_path
    );
    UPDATE students SET pending_assessment_point_id = point_id WHERE id = in_student_id;
  END IF;

  RETURN session_id;
END
$function$;

REVOKE ALL ON FUNCTION public.record_assessment_lesson_session(uuid, uuid, date, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_assessment_lesson_session(uuid, uuid, date, text, text) TO authenticated, service_role;

-- Keep the database invariant intact if an older client or another RPC tries
-- to record an assessment-required lesson through the regular session path.
CREATE OR REPLACE FUNCTION public.require_assessment_result_for_session()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.actual_lesson_id IS NOT DISTINCT FROM NEW.actual_lesson_id THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.lessons l
    WHERE l.id = NEW.actual_lesson_id
      AND l.assessment_required
  ) AND NOT EXISTS (
    SELECT 1
    FROM public.assessments a
    WHERE a.attended_session_id = NEW.id
  ) THEN
    RAISE EXCEPTION 'Assessment lessons must be recorded with a PASS or FAIL result';
  END IF;

  RETURN NEW;
END
$function$;

REVOKE ALL ON FUNCTION public.require_assessment_result_for_session() FROM PUBLIC, anon, authenticated;

CREATE CONSTRAINT TRIGGER attended_session_requires_assessment_result
AFTER INSERT OR UPDATE ON public.attended_sessions
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION public.require_assessment_result_for_session();
