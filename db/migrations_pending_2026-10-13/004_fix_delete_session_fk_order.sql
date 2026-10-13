-- Delete the referencing attended session before deleting its lesson record.
CREATE OR REPLACE FUNCTION public.delete_attended_session(in_session_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor uuid;
  session_student uuid;
  session_centre uuid;
  record_id uuid;
  has_assessment boolean;
  has_remediation boolean;
  has_other_sessions boolean;
BEGIN
  SELECT id INTO actor FROM profiles
  WHERE auth_id = auth.uid() AND role IN ('admin', 'instructor');
  IF actor IS NULL THEN RAISE EXCEPTION 'Staff authentication is required'; END IF;

  SELECT student_id, centre_id, lesson_record_id
    INTO session_student, session_centre, record_id
  FROM attended_sessions WHERE id = in_session_id FOR UPDATE;
  IF session_student IS NULL THEN RAISE EXCEPTION 'Session not found'; END IF;
  IF NOT public.can_access_centre(session_centre) THEN
    RAISE EXCEPTION 'You do not have access to this session''s centre';
  END IF;

  SELECT EXISTS (SELECT 1 FROM assessments WHERE attended_session_id = in_session_id)
    INTO has_assessment;
  SELECT EXISTS (SELECT 1 FROM remediation_lessons WHERE attended_session_id = in_session_id)
    INTO has_remediation;
  IF has_assessment OR has_remediation THEN
    RAISE EXCEPTION 'Assessment or remediation sessions cannot be removed from lesson history';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM attended_sessions other
    WHERE other.id <> in_session_id AND other.lesson_record_id = record_id
  ) INTO has_other_sessions;

  IF record_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM term_time_followups WHERE lesson_record_id = record_id)
     AND NOT has_other_sessions THEN
    RAISE EXCEPTION 'This lesson is used by a term follow-up and cannot be removed here';
  END IF;

  IF record_id IS NOT NULL AND NOT has_other_sessions THEN
    DELETE FROM feedback_sheets
      WHERE attended_session_id = in_session_id OR lesson_record_id = record_id;
    DELETE FROM attended_sessions WHERE id = in_session_id;
    DELETE FROM lesson_records WHERE id = record_id;
  ELSE
    DELETE FROM feedback_sheets WHERE attended_session_id = in_session_id;
    DELETE FROM attended_sessions WHERE id = in_session_id;
  END IF;
END
$$;

REVOKE ALL ON FUNCTION public.delete_attended_session(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_attended_session(uuid) TO authenticated, service_role;
