-- Attendance session_type (regular/catch_up/special), kept in sync with the
-- existing catch_up boolean via trigger, plus the term_time_followups
-- table for the 12-lesson Term Time block reminder.
ALTER TABLE public.attendance
  ADD COLUMN session_type text NOT NULL DEFAULT 'regular'
    CHECK (session_type IN ('regular','catch_up','special'));
UPDATE public.attendance SET session_type = CASE WHEN catch_up THEN 'catch_up' ELSE 'regular' END;

CREATE OR REPLACE FUNCTION public.sync_attendance_catch_up()
 RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  NEW.catch_up := (NEW.session_type <> 'regular');
  RETURN NEW;
END $$;
CREATE TRIGGER attendance_sync_catch_up
  BEFORE INSERT OR UPDATE ON public.attendance
  FOR EACH ROW EXECUTE FUNCTION public.sync_attendance_catch_up();

CREATE TABLE public.term_time_followups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  lesson_record_id uuid NOT NULL UNIQUE REFERENCES public.lesson_records(id) ON DELETE CASCADE,
  lessons_completed_in_block int NOT NULL,
  status text NOT NULL DEFAULT 'needs_follow_up'
    CHECK (status IN ('needs_follow_up','contacted','extended','not_continuing','snoozed')),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.profiles(id)
);
CREATE INDEX term_time_followups_student_id_idx ON public.term_time_followups(student_id);
CREATE INDEX term_time_followups_outstanding_idx ON public.term_time_followups(status) WHERE status = 'needs_follow_up';

CREATE OR REPLACE FUNCTION public.touch_term_time_followups_updated_at()
 RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;
CREATE TRIGGER term_time_followups_touch_updated_at
  BEFORE UPDATE ON public.term_time_followups
  FOR EACH ROW EXECUTE FUNCTION public.touch_term_time_followups_updated_at();

ALTER TABLE public.term_time_followups ENABLE ROW LEVEL SECURITY;
CREATE POLICY term_time_followups_select ON public.term_time_followups FOR SELECT USING (is_admin() OR is_management());
CREATE POLICY term_time_followups_admin_write ON public.term_time_followups FOR ALL USING (is_admin()) WITH CHECK (is_admin());
