-- Applied directly to the live Supabase project.
-- Feedback must be 1:1 with an attended SESSION, not a lesson_records row:
-- two distinct sessions can point at the same lesson_records row (e.g. two
-- same-day sessions that are both "Lesson 5"), which would violate the old
-- lesson_record_id UNIQUE constraint if both tried to get their own
-- feedback sheet. Non-destructive: lesson_record_id is kept (still
-- populated on new rows, just no longer NOT NULL/unique) so existing rows
-- and joins keep working; attended_session_id is the new uniqueness anchor.
ALTER TABLE public.feedback_sheets
  ADD COLUMN attended_session_id uuid REFERENCES public.attended_sessions(id) ON DELETE CASCADE;

ALTER TABLE public.feedback_sheets ALTER COLUMN lesson_record_id DROP NOT NULL;
ALTER TABLE public.feedback_sheets DROP CONSTRAINT feedback_sheets_lesson_record_id_key;

CREATE UNIQUE INDEX feedback_sheets_attended_session_id_key
  ON public.feedback_sheets(attended_session_id)
  WHERE attended_session_id IS NOT NULL;
