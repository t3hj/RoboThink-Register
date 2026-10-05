-- Explicitly keep curriculum data private in Supabase.
-- Apply after the curriculum tables and staff role helpers exist.
-- This migration is safe to re-run.

ALTER TABLE public.levels ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lessons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assessment_points ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.remediation_lessons ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.levels FROM PUBLIC, anon;
REVOKE ALL ON public.lessons FROM PUBLIC, anon;
REVOKE ALL ON public.assessment_points FROM PUBLIC, anon;
REVOKE ALL ON public.remediation_lessons FROM PUBLIC, anon;

GRANT SELECT ON public.levels TO authenticated;
GRANT SELECT ON public.lessons TO authenticated;
GRANT SELECT ON public.assessment_points TO authenticated;
GRANT SELECT ON public.remediation_lessons TO authenticated;

DROP POLICY IF EXISTS levels_select_staff ON public.levels;
CREATE POLICY levels_select_staff ON public.levels
  FOR SELECT USING (public.is_admin() OR public.is_instructor() OR public.is_management());

DROP POLICY IF EXISTS lessons_select_staff ON public.lessons;
CREATE POLICY lessons_select_staff ON public.lessons
  FOR SELECT USING (public.is_admin() OR public.is_instructor() OR public.is_management());

DROP POLICY IF EXISTS assessment_points_select_staff ON public.assessment_points;
CREATE POLICY assessment_points_select_staff ON public.assessment_points
  FOR SELECT USING (public.is_admin() OR public.is_instructor() OR public.is_management());

DROP POLICY IF EXISTS remediation_lessons_select_staff ON public.remediation_lessons;
CREATE POLICY remediation_lessons_select_staff ON public.remediation_lessons
  FOR SELECT USING (public.is_admin() OR public.is_instructor() OR public.is_management());
