-- Additive change only: after completing a lesson, if the student is on
-- the Term Time subscription and just completed a multiple of 12 lessons,
-- create a follow-up reminder. All other logic (progression, remediation,
-- term-boundary, feedback-sheet creation) is unchanged from the previous
-- version of this function.
CREATE OR REPLACE FUNCTION public.complete_current_lesson(in_student_id uuid, in_date date DEFAULT CURRENT_DATE)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE actor uuid; lesson uuid; lvl int; num int; nxt uuid; pt uuid; lr_id uuid; is_term_time boolean;
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
      SET status='completed', date=EXCLUDED.date, instructor_id=EXCLUDED.instructor_id, lesson_id=EXCLUDED.lesson_id
    RETURNING id INTO lr_id;
  INSERT INTO feedback_sheets(lesson_record_id, student_id, status, created_by, updated_by)
    VALUES(lr_id, in_student_id, 'not_written', actor, actor)
    ON CONFLICT (lesson_record_id) DO NOTHING;
  SELECT EXISTS(
    SELECT 1 FROM students s JOIN subscriptions sub ON sub.id = s.subscription_id
    WHERE s.id = in_student_id AND sub.name = 'Term Time'
  ) INTO is_term_time;
  IF is_term_time AND num % 12 = 0 THEN
    INSERT INTO term_time_followups(student_id, lesson_record_id, lessons_completed_in_block)
      VALUES(in_student_id, lr_id, num)
      ON CONFLICT (lesson_record_id) DO NOTHING;
  END IF;
  SELECT id INTO pt FROM assessment_points WHERE after_lesson_id=lesson AND active;
  nxt:=next_curriculum_lesson(lesson);
  UPDATE students SET current_lesson_id=nxt,current_level_id=(SELECT level_id FROM lessons WHERE id=nxt),pending_assessment_point_id=pt WHERE id=in_student_id;
  RETURN nxt;
END
$function$;
