-- Applied directly to the live Supabase project. Extends the EXISTING
-- functions (same core logic, reused not replaced) with
-- in_attended_session_id (links the event to its session) and, on
-- record_assessment_result, in_remediation_path (required on a fresh
-- FAIL; a reassessment FAIL still always goes to intervention_required
-- regardless of path, unchanged). Verified live end-to-end for both paths
-- plus the full remediation-lessons -> reassessment -> intervention
-- sequence, against temporary, fully-cleaned-up test students. See task
-- report for details.
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
  SELECT * INTO p FROM remediation_plans WHERE student_id=in_student_id AND status IN ('required','in_progress') ORDER BY created_at DESC LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No active remediation plan'; END IF;
  n:=p.lessons_completed+1;
  INSERT INTO remediation_lessons(remediation_plan_id,student_id,level_id,lesson_number,date,topic,notes,instructor_id,status,attended_session_id)
    VALUES(p.id,in_student_id,p.level_id,n,in_date,p.topic,in_notes,actor,'completed',in_attended_session_id);
  UPDATE remediation_plans SET lessons_completed=n,status=CASE WHEN n>=lessons_required THEN 'ready_for_reassessment' ELSE 'in_progress' END,completed_at=CASE WHEN n>=lessons_required THEN now() ELSE NULL END WHERE id=p.id;
  RETURN n;
END
$function$;
