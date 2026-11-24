-- Session-based follow-ups are derived from attended visits in the dashboard.
-- Persist only staff decisions, keyed to each 12-session block. Existing
-- lesson-linked follow-ups remain intact and visible as earlier follow-ups.
ALTER TABLE public.term_time_followups
  ALTER COLUMN lesson_record_id DROP NOT NULL,
  ALTER COLUMN lessons_completed_in_block DROP NOT NULL,
  ADD COLUMN session_block integer,
  ADD COLUMN next_follow_up_date date,
  ADD CONSTRAINT term_time_followups_session_block_positive CHECK (session_block IS NULL OR session_block > 0),
  ADD CONSTRAINT term_time_followups_reference_required CHECK (session_block IS NOT NULL OR lesson_record_id IS NOT NULL),
  ADD CONSTRAINT term_time_followups_student_session_block_key UNIQUE (student_id, session_block);

COMMENT ON COLUMN public.term_time_followups.session_block IS
  'One-based 12-attended-session block. NULL identifies a preserved legacy lesson-based follow-up.';

-- Management may record contact, notes and the next contact date only for
-- students they can already access in the active brand and assigned centre.
CREATE POLICY term_time_followups_management_insert ON public.term_time_followups
  FOR INSERT TO authenticated
  WITH CHECK (public.is_management() AND public.can_access_student(student_id) AND session_block IS NOT NULL);
CREATE POLICY term_time_followups_management_update ON public.term_time_followups
  FOR UPDATE TO authenticated
  USING (public.is_management() AND public.can_access_student(student_id) AND session_block IS NOT NULL)
  WITH CHECK (public.is_management() AND public.can_access_student(student_id) AND session_block IS NOT NULL);

-- Remove the old lesson-number trigger point while preserving progression.
-- Reminders now follow attended session counts, including unfinished work,
-- assessments, projects, catch-ups and explicitly recorded double sessions.
CREATE OR REPLACE FUNCTION public.advance_after_completion(in_student_id uuid, in_actual_lesson_id uuid, in_lesson_record_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE nxt uuid; pt uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.profiles WHERE auth_id = auth.uid() AND role IN ('admin', 'instructor')
  ) OR NOT public.can_access_student(in_student_id) THEN
    RAISE EXCEPTION 'Staff authentication and student access are required';
  END IF;
  SELECT id INTO pt FROM public.assessment_points WHERE after_lesson_id = in_actual_lesson_id AND active;
  nxt := public.next_curriculum_lesson(in_actual_lesson_id);
  UPDATE public.students
    SET current_lesson_id = nxt,
        current_level_id = (SELECT level_id FROM public.lessons WHERE id = nxt),
        pending_assessment_point_id = pt
    WHERE id = in_student_id;
END
$function$;
REVOKE ALL ON FUNCTION public.advance_after_completion(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
