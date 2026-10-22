-- Lets an instructor (or admin/manager) choose the starting lesson for a
-- student who doesn't have one yet, e.g. a student imported from Pebble.
-- It can only be used while the student has no current lesson, so it cannot be
-- used to rewrite an existing student's progress. Instructors still have no
-- general write access to the students table.

CREATE OR REPLACE FUNCTION public.set_starting_lesson(p_student_id uuid, p_lesson_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_level_id integer;
BEGIN
  IF NOT (is_admin() OR is_management() OR is_instructor()) THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  IF NOT can_access_student(p_student_id) THEN
    RAISE EXCEPTION 'Not allowed for this student' USING ERRCODE = '42501';
  END IF;

  SELECT level_id INTO v_level_id FROM public.lessons WHERE id = p_lesson_id;
  IF v_level_id IS NULL THEN
    RAISE EXCEPTION 'Unknown lesson';
  END IF;

  UPDATE public.students
     SET current_level_id = v_level_id,
         current_lesson_id = p_lesson_id
   WHERE id = p_student_id
     AND current_lesson_id IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'This student already has a starting lesson';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.set_starting_lesson(uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.set_starting_lesson(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_starting_lesson(uuid, uuid) TO authenticated;
