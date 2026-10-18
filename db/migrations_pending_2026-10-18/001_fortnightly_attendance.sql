-- Support students who attend every other week (typically two sessions in
-- their "on" week). Weekly remains the default, so existing students and
-- every existing query are unaffected.
-- Apply manually after reviewing; the frontend only writes these columns when
-- an instructor picks "Fortnightly" for a student.

ALTER TABLE public.students
  ADD COLUMN IF NOT EXISTS attendance_pattern text NOT NULL DEFAULT 'weekly',
  ADD COLUMN IF NOT EXISTS fortnight_anchor date;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.students'::regclass AND conname = 'students_attendance_pattern_allowed') THEN
    ALTER TABLE public.students
      ADD CONSTRAINT students_attendance_pattern_allowed CHECK (attendance_pattern IN ('weekly', 'fortnightly'));
  END IF;
  -- A fortnightly student needs an anchor so the app knows which weeks are "on".
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.students'::regclass AND conname = 'students_fortnight_anchor_required') THEN
    ALTER TABLE public.students
      ADD CONSTRAINT students_fortnight_anchor_required CHECK (attendance_pattern = 'weekly' OR fortnight_anchor IS NOT NULL);
  END IF;
END $$;

COMMENT ON COLUMN public.students.attendance_pattern IS 'weekly (default) or fortnightly (every second week).';
COMMENT ON COLUMN public.students.fortnight_anchor IS 'Any date inside one of the student''s "on" weeks; every second week from it is also "on".';
