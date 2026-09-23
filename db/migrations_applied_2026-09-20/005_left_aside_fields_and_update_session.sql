-- Applied directly to the live Supabase project. Task 2's concrete gap:
-- no existing field could store "a build/laptop was left aside, with this
-- identifier, for this reason" so the reminder can follow the student to
-- their next session. Small, additive, nullable columns on the session
-- itself (per-occurrence information, so it belongs on attended_sessions,
-- not a new table).
ALTER TABLE public.attended_sessions
  ADD COLUMN left_aside boolean NOT NULL DEFAULT false,
  ADD COLUMN left_aside_identifier text,
  ADD COLUMN left_aside_reason text
    CHECK (left_aside_reason IS NULL OR left_aside_reason IN (
      'motors_not_working', 'sensor_issue', 'missing_pieces', 'build_incomplete',
      'coding_incomplete', 'ran_out_of_time', 'needed_help', 'other'
    )),
  ADD COLUMN left_aside_note text,
  ADD CONSTRAINT attended_sessions_left_aside_requires_details
    CHECK (NOT left_aside OR (left_aside_identifier IS NOT NULL AND left_aside_reason IS NOT NULL)),
  ADD CONSTRAINT attended_sessions_other_reason_requires_note
    CHECK (left_aside_reason IS DISTINCT FROM 'other' OR left_aside_note IS NOT NULL);
