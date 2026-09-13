-- Applied directly to the live Supabase project (bvbrafmazxrfiaocqdjg) on 2026-09-13.
-- 1) These views were SECURITY DEFINER, which bypasses RLS. Combined with
--    Supabase's default anon grants, this let unauthenticated requests read
--    student/assessment/remediation data via /rest/v1/<view>.
ALTER VIEW public.student_assessment_status SET (security_invoker = true);
ALTER VIEW public.students_requiring_assessment_action SET (security_invoker = true);
ALTER VIEW public.total_lessons_per_level SET (security_invoker = true);

-- 2) curriculum_progression_log had RLS enabled but no policies (silently
--    unreadable by staff too). Add a staff-read policy.
CREATE POLICY curriculum_progression_log_select_staff ON public.curriculum_progression_log
  FOR SELECT
  USING (public.is_admin() OR public.is_instructor());
