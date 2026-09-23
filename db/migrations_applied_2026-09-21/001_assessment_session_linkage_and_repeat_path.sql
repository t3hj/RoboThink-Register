-- Applied directly to the live Supabase project (bvbrafmazxrfiaocqdjg).
-- Link assessment events and remediation lessons to the specific attended
-- session they happened in. Nullable/additive — existing rows untouched.
ALTER TABLE public.assessments
  ADD COLUMN attended_session_id uuid REFERENCES public.attended_sessions(id) ON DELETE SET NULL;
ALTER TABLE public.remediation_lessons
  ADD COLUMN attended_session_id uuid REFERENCES public.attended_sessions(id) ON DELETE SET NULL;

-- Track which remediation path was chosen on a FAIL. 'remediation_lessons'
-- (the only-ever prior behaviour: 3 lessons then reassess) stays default;
-- 'repeat_next_lesson' is the new Path A (reassess with no required
-- lessons in between).
ALTER TABLE public.remediation_plans
  ADD COLUMN remediation_path text NOT NULL DEFAULT 'remediation_lessons'
    CHECK (remediation_path IN ('repeat_next_lesson', 'remediation_lessons'));

-- Path A needs lessons_required = 0. Was hard-locked to exactly 3 — widen
-- to allow 0 as well; existing rows (all currently 3) are unaffected.
ALTER TABLE public.remediation_plans DROP CONSTRAINT remediation_plans_lessons_required_check;
ALTER TABLE public.remediation_plans
  ADD CONSTRAINT remediation_plans_lessons_required_check CHECK (lessons_required IN (0, 3));
