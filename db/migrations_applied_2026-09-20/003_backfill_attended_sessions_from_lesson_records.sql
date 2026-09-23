-- Applied directly to the live Supabase project.
-- Backfill: one attended_sessions row per existing lesson_records row —
-- the best available approximation from history. A lesson repeated 3x
-- before being completed only ever left ONE lesson_records row under the
-- old model, so true multi-session granularity for that specific case
-- can't be recovered; this does not invent sessions that weren't
-- recorded, it just gives every existing record a session identity so
-- feedback history displays consistently for old and new rows alike.
-- Verified 1:1 against live data: 107 lesson_records -> 107 sessions,
-- 65/65 existing feedback_sheets rows linked, zero orphans.
INSERT INTO public.attended_sessions (student_id, date, session_number, actual_lesson_id, outcome, lesson_record_id, instructor_id, created_at)
SELECT
  lr.student_id,
  lr.date,
  ROW_NUMBER() OVER (PARTITION BY lr.student_id, lr.date ORDER BY lr.created_at),
  lr.lesson_id,
  CASE WHEN lr.status = 'completed' THEN 'completed' ELSE 'not_finished' END,
  lr.id,
  lr.instructor_id,
  lr.created_at
FROM public.lesson_records lr;

UPDATE public.feedback_sheets fs
SET attended_session_id = s.id
FROM public.attended_sessions s
WHERE s.lesson_record_id = fs.lesson_record_id
  AND fs.attended_session_id IS NULL;
