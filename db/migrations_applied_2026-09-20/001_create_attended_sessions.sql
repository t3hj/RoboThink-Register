-- Applied directly to the live Supabase project (bvbrafmazxrfiaocqdjg).
--
-- WHY A NEW TABLE (not just extending lesson_records):
-- lesson_records has UNIQUE(student_id, level_id, lesson_number) — it is a
-- per-lesson LEDGER (one row = the current state of that lesson for that
-- student), not a per-occurrence LOG. That constraint is exactly right for
-- progression math (next_curriculum_lesson, remediation, etc.) and must
-- stay untouched. But it makes it structurally impossible to represent:
--   - two sessions on the same date for the same student (e.g. two
--     different lessons, or the same lesson twice) as two rows, and
--   - a repeat of an already-completed lesson as a NEW record rather than
--     silently overwriting the existing one.
-- attended_sessions is the new, append-only "one row per attended
-- occurrence" ledger. lesson_records is left completely alone in shape
-- and constraint; attended_sessions references it, it does not replace it.
CREATE TABLE public.attended_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  date date NOT NULL,
  session_number int NOT NULL DEFAULT 1,
  actual_lesson_id uuid NOT NULL REFERENCES public.lessons(id),
  outcome text NOT NULL CHECK (outcome IN ('completed', 'not_finished')),
  lesson_record_id uuid REFERENCES public.lesson_records(id),
  instructor_id uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (student_id, date, session_number)
);

CREATE INDEX attended_sessions_student_id_idx ON public.attended_sessions(student_id);
CREATE INDEX attended_sessions_date_idx ON public.attended_sessions(date);

ALTER TABLE public.attended_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY attended_sessions_select_staff ON public.attended_sessions
  FOR SELECT USING (is_admin() OR is_instructor() OR is_management());
CREATE POLICY attended_sessions_write_staff ON public.attended_sessions
  FOR INSERT WITH CHECK (is_admin() OR is_instructor());
