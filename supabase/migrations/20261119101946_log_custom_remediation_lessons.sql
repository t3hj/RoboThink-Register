ALTER TABLE public.attended_sessions
  ADD COLUMN remediation_title text,
  DROP CONSTRAINT attended_sessions_activity_present,
  ADD CONSTRAINT attended_sessions_activity_present CHECK (
    (remediation_title IS NULL AND (actual_lesson_id IS NOT NULL OR project_id IS NOT NULL))
    OR (remediation_title IS NOT NULL AND char_length(btrim(remediation_title)) BETWEEN 1 AND 120
      AND actual_lesson_id IS NULL AND project_id IS NULL AND lesson_record_id IS NULL)
  );

-- Keep the existing assessment rules and save the focus in the same transaction.
CREATE FUNCTION public.record_assessment_with_focus(
  in_student_id uuid,
  in_assessment_lesson_id uuid,
  in_date date,
  in_remediation_path text,
  in_focus_note text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  session_id uuid;
  focus_note text := nullif(btrim(in_focus_note), '');
BEGIN
  IF char_length(focus_note) > 1000 THEN
    RAISE EXCEPTION 'Keep the assessment focus note to 1000 characters';
  END IF;

  session_id := public.record_assessment_lesson_session(
    in_student_id, in_assessment_lesson_id, in_date, 'FAIL', in_remediation_path
  );

  UPDATE public.assessments SET notes = focus_note
  WHERE attended_session_id = session_id AND student_id = in_student_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'The assessment focus note could not be saved'; END IF;

  RETURN session_id;
END;
$$;

CREATE FUNCTION public.record_remediation_lesson_session(
  in_student_id uuid,
  in_plan_id uuid,
  in_lesson_number integer,
  in_date date,
  in_session_id uuid,
  in_title text,
  in_notes text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor uuid;
  session_centre uuid;
  session_num integer;
  recorded_lesson_number integer;
  plan public.remediation_plans%ROWTYPE;
  lesson_title text := nullif(btrim(in_title), '');
  lesson_notes text := nullif(btrim(in_notes), '');
BEGIN
  SELECT id INTO actor FROM public.profiles
    WHERE auth_id = auth.uid() AND role IN ('admin', 'instructor');
  IF actor IS NULL THEN RAISE EXCEPTION 'Staff authentication is required'; END IF;
  IF NOT public.can_access_student(in_student_id) THEN
    RAISE EXCEPTION 'You do not have access to this student''s centre';
  END IF;
  IF in_date IS NULL OR in_date > CURRENT_DATE THEN RAISE EXCEPTION 'Choose an attended date on or before today'; END IF;
  IF lesson_title IS NULL OR char_length(lesson_title) > 120 THEN
    RAISE EXCEPTION 'Enter a remediation lesson title of up to 120 characters';
  END IF;
  IF char_length(lesson_notes) > 1000 THEN RAISE EXCEPTION 'Keep the lesson notes to 1000 characters'; END IF;

  SELECT centre_id INTO session_centre FROM public.students WHERE id = in_student_id FOR UPDATE;
  IF session_centre IS NULL THEN RAISE EXCEPTION 'Student has no centre assigned'; END IF;

  -- A retry after the save committed should return the same session, even after lesson 3.
  IF EXISTS (
    SELECT 1 FROM public.remediation_lessons r
    JOIN public.attended_sessions s ON s.id = r.attended_session_id
    WHERE s.id = in_session_id AND r.remediation_plan_id = in_plan_id
      AND r.student_id = in_student_id AND r.date = in_date
      AND r.lesson_number = in_lesson_number AND s.remediation_title = lesson_title
      AND r.notes IS NOT DISTINCT FROM lesson_notes
  ) THEN
    RETURN in_session_id;
  END IF;

  SELECT * INTO plan FROM public.remediation_plans
    WHERE id = in_plan_id AND student_id = in_student_id FOR UPDATE;
  IF NOT FOUND OR plan.status NOT IN ('required', 'in_progress')
    OR in_lesson_number IS DISTINCT FROM plan.lessons_completed + 1 THEN
    RAISE EXCEPTION 'Remediation progress has changed. Refresh the register before recording another lesson';
  END IF;
  IF EXISTS (SELECT 1 FROM public.assessments WHERE id = plan.assessment_id AND date > in_date) THEN
    RAISE EXCEPTION 'Choose a session date on or after the failed assessment';
  END IF;

  UPDATE public.attendance SET status = 'Completed'
    WHERE student_id = in_student_id AND date = in_date AND status IN ('Arrived', 'Completed');
  IF NOT FOUND THEN RAISE EXCEPTION 'Mark the student attended on this date before recording remediation'; END IF;

  SELECT coalesce(max(session_number), 0) + 1 INTO session_num
    FROM public.attended_sessions WHERE student_id = in_student_id AND date = in_date;
  INSERT INTO public.attended_sessions (id, student_id, date, session_number, remediation_title, outcome, instructor_id, centre_id)
    VALUES (in_session_id, in_student_id, in_date, session_num, lesson_title, 'completed', actor, session_centre);

  recorded_lesson_number := public.complete_remediation_lesson(in_student_id, in_date, lesson_notes, in_session_id);
  IF recorded_lesson_number IS DISTINCT FROM in_lesson_number
    OR NOT EXISTS (
      SELECT 1 FROM public.remediation_lessons
      WHERE attended_session_id = in_session_id AND remediation_plan_id = in_plan_id
    ) THEN
    RAISE EXCEPTION 'Remediation progress has changed. Refresh the register before recording another lesson';
  END IF;

  INSERT INTO public.feedback_sheets (attended_session_id, student_id, status, created_by, updated_by)
    VALUES (in_session_id, in_student_id, 'not_written', actor, actor)
    ON CONFLICT (attended_session_id) WHERE attended_session_id IS NOT NULL DO NOTHING;

  RETURN in_session_id;
END;
$$;

REVOKE ALL ON FUNCTION public.record_assessment_with_focus(uuid, uuid, date, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.record_remediation_lesson_session(uuid, uuid, integer, date, uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_assessment_with_focus(uuid, uuid, date, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_remediation_lesson_session(uuid, uuid, integer, date, uuid, text, text) TO authenticated, service_role;
