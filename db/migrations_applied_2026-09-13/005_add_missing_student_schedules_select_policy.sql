-- Applied directly to the live Supabase project.
-- Incidental fix found while inspecting the schema for the repeat-lesson
-- task: student_schedules has RLS enabled with zero policies (silently
-- blocks everyone, including staff). Not used by this task's features yet,
-- but a one-line, safe fix consistent with the earlier curriculum_progression_log fix.
CREATE POLICY student_schedules_select_staff ON public.student_schedules
  FOR SELECT
  USING (public.is_admin() OR public.is_instructor());
