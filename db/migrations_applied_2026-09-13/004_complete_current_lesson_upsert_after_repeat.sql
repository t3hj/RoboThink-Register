-- Applied directly to the live Supabase project (bvbrafmazxrfiaocqdjg).
-- Smallest necessary change to support "Not Finished / Repeat Lesson":
-- a repeat writes a lesson_records row (status='not_completed') for
-- (student, level, lesson_number). Because of the existing
-- UNIQUE(student_id, level_id, lesson_number) constraint, actually
-- completing that same lesson afterwards previously hit
-- ON CONFLICT DO NOTHING and left the history row stuck on
-- 'not_completed' forever (progression itself still worked correctly
-- either way — current_lesson_id is updated unconditionally below).
-- This changes it to DO UPDATE so the historical record ends up accurate.
-- Everything else (staff-auth check, remediation gating, term-boundary
-- progression via next_curriculum_lesson) is completely unchanged.
CREATE OR REPLACE FUNCTION public.complete_current_lesson(in_student_id uuid, in_date date DEFAULT CURRENT_DATE)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE actor uuid; lesson uuid; lvl int; num int; nxt uuid; pt uuid;
BEGIN
  SELECT id INTO actor FROM profiles WHERE auth_id=auth.uid() AND role IN ('admin','instructor');
  IF actor IS NULL THEN RAISE EXCEPTION 'Staff authentication is required'; END IF;
  IF in_date>CURRENT_DATE THEN RAISE EXCEPTION 'Completion date cannot be in the future'; END IF;
  SELECT current_lesson_id,current_level_id INTO lesson,lvl FROM students WHERE id=in_student_id FOR UPDATE;
  IF lesson IS NULL THEN RAISE EXCEPTION 'Student has no current lesson'; END IF;
  IF EXISTS(SELECT 1 FROM remediation_plans WHERE student_id=in_student_id AND status IN ('required','in_progress','ready_for_reassessment','intervention_required')) THEN
    RAISE EXCEPTION 'Remediation must be resolved first';
  END IF;
  SELECT lesson_number INTO num FROM lessons WHERE id=lesson AND level_id=lvl AND lesson_kind='normal';
  IF num IS NULL THEN RAISE EXCEPTION 'Invalid current lesson'; END IF;
  INSERT INTO lesson_records(student_id,level_id,lesson_number,lesson_id,date,instructor_id,status)
    VALUES(in_student_id,lvl,num,lesson,in_date,actor,'completed')
    ON CONFLICT(student_id,level_id,lesson_number) DO UPDATE
      SET status='completed', date=EXCLUDED.date, instructor_id=EXCLUDED.instructor_id, lesson_id=EXCLUDED.lesson_id;
  SELECT id INTO pt FROM assessment_points WHERE after_lesson_id=lesson AND active;
  nxt:=next_curriculum_lesson(lesson);
  UPDATE students SET current_lesson_id=nxt,current_level_id=(SELECT level_id FROM lessons WHERE id=nxt),pending_assessment_point_id=pt WHERE id=in_student_id;
  RETURN nxt;
END
$function$;
