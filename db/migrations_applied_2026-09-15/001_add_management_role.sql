-- Adds the 'management' role, an is_management() helper, and widens
-- set_student_current_lesson to allow instructors (previously admin-only)
-- per this task's explicit business-rule change. Reason is still required
-- and every change is still audited exactly as before.
ALTER TABLE public.profiles DROP CONSTRAINT profiles_role_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_role_check
  CHECK (role = ANY (ARRAY['admin'::text, 'instructor'::text, 'management'::text]));

CREATE OR REPLACE FUNCTION public.is_management()
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT EXISTS (SELECT 1 FROM public.profiles p WHERE p.auth_id = auth.uid() AND p.role = 'management');
$function$;

CREATE OR REPLACE FUNCTION public.set_student_current_lesson(in_student_id uuid, in_lesson_id uuid, in_reason text)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE actor uuid; old_level int; old_lesson uuid; target_level int;
BEGIN
  SELECT id INTO actor FROM profiles WHERE auth_id=auth.uid() AND role IN ('admin','instructor');
  IF actor IS NULL THEN RAISE EXCEPTION 'Only staff may change a student''s current lesson'; END IF;
  IF COALESCE(trim(in_reason),'')='' THEN RAISE EXCEPTION 'A reason is required'; END IF;
  SELECT current_level_id,current_lesson_id INTO old_level,old_lesson FROM students WHERE id=in_student_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Student not found'; END IF;
  SELECT level_id INTO target_level FROM lessons WHERE id=in_lesson_id AND lesson_kind='normal';
  IF target_level IS NULL THEN RAISE EXCEPTION 'Invalid lesson'; END IF;
  UPDATE students SET current_level_id=target_level,current_lesson_id=in_lesson_id,pending_assessment_point_id=NULL,override_next_lesson=NULL WHERE id=in_student_id;
  INSERT INTO progress_overrides(student_id,new_lesson,reason,admin_id,previous_level_id,new_level_id,previous_lesson_id,new_lesson_id)
    VALUES(in_student_id,(SELECT lesson_number FROM lessons WHERE id=in_lesson_id),trim(in_reason),actor,old_level,target_level,old_lesson,in_lesson_id);
  INSERT INTO audit_log(actor_id,action,object_type,object_id,before,after)
    VALUES(actor,'set_current_lesson','student',in_student_id::text,jsonb_build_object('level_id',old_level,'lesson_id',old_lesson),jsonb_build_object('level_id',target_level,'lesson_id',in_lesson_id));
END
$function$;
