-- Applied directly to the live Supabase project on 2026-09-13.
-- Advisor: function search_path mutable. Pin search_path on all flagged
-- functions to prevent search_path hijacking.
ALTER FUNCTION public.after_assessment_processed() SET search_path = public;
ALTER FUNCTION public.assessment_is_passed(in_result text, in_passed boolean) SET search_path = public;
ALTER FUNCTION public.assign_assessment_attempt_number() SET search_path = public;
ALTER FUNCTION public.compute_next_lesson(in_student uuid) SET search_path = public;
ALTER FUNCTION public.create_remediation_plan_for_assessment(in_assessment_id uuid) SET search_path = public;
ALTER FUNCTION public.get_next_level(in_level_id integer) SET search_path = public;
ALTER FUNCTION public.initial_programme_for_dob(in_date_of_birth date, in_joined date) SET search_path = public;
ALTER FUNCTION public.next_curriculum_lesson(in_lesson_id uuid) SET search_path = public;
ALTER FUNCTION public.next_lessons_for_students(in_ids uuid[]) SET search_path = public;
ALTER FUNCTION public.progress_student_after_assessment(in_assessment_id uuid) SET search_path = public;
ALTER FUNCTION public.update_remediation_progress() SET search_path = public;
ALTER FUNCTION public.validate_assessment() SET search_path = public;
ALTER FUNCTION public.validate_attendance() SET search_path = public;
ALTER FUNCTION public.validate_lesson_record() SET search_path = public;
ALTER FUNCTION public.validate_remediation_lesson() SET search_path = public;
