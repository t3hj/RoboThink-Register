-- Applied directly to the live Supabase project (bvbrafmazxrfiaocqdjg).
-- Feedback-sheet tracking, tied to the actual completed session
-- (lesson_records row), not the student's timetable — so it follows the
-- student to whatever day they next appear on (normal, catch-up, or
-- otherwise). Deliberately does NOT duplicate student/lesson/date data:
-- those are all reachable via lesson_record_id -> lesson_records.
CREATE TABLE public.feedback_sheets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lesson_record_id uuid NOT NULL UNIQUE REFERENCES public.lesson_records(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'not_written' CHECK (status IN ('not_written','written_not_taken','given')),
  created_by uuid REFERENCES public.profiles(id),
  updated_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX feedback_sheets_student_id_idx ON public.feedback_sheets(student_id);
CREATE INDEX feedback_sheets_outstanding_idx ON public.feedback_sheets(student_id) WHERE status <> 'given';

CREATE OR REPLACE FUNCTION public.touch_feedback_sheets_updated_at()
 RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

CREATE TRIGGER feedback_sheets_touch_updated_at
  BEFORE UPDATE ON public.feedback_sheets
  FOR EACH ROW EXECUTE FUNCTION public.touch_feedback_sheets_updated_at();

ALTER TABLE public.feedback_sheets ENABLE ROW LEVEL SECURITY;

-- Same staff-wide access model as every other operational table in this
-- app (lesson_records, attendance, assessments) — there is no concept of
-- "assigned students" elsewhere, so we don't invent one here.
CREATE POLICY feedback_sheets_select_staff ON public.feedback_sheets
  FOR SELECT USING (public.is_admin() OR public.is_instructor());
CREATE POLICY feedback_sheets_insert_staff ON public.feedback_sheets
  FOR INSERT WITH CHECK (public.is_admin() OR public.is_instructor());
CREATE POLICY feedback_sheets_update_staff ON public.feedback_sheets
  FOR UPDATE USING (public.is_admin() OR public.is_instructor());
