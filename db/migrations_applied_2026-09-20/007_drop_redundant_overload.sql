-- Applied directly to the live Supabase project.
-- CREATE OR REPLACE with a different arg list creates a new overload
-- rather than replacing the old one. Drops the now-redundant 4-arg
-- record_attended_session; complete_current_lesson updated to call the
-- 8-arg version explicitly (passing false/NULL for the left-aside args).
DROP FUNCTION IF EXISTS public.record_attended_session(uuid, uuid, text, date);

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
  PERFORM record_attended_session(in_student_id, current_lesson, 'completed', in_date, false, NULL, NULL, NULL);
  RETURN (SELECT current_lesson_id FROM students WHERE id = in_student_id);
END
$function$;
