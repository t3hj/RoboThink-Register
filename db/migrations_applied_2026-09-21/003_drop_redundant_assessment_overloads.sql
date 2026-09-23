-- Applied directly to the live Supabase project.
-- Same overload-cleanup pattern as Task 2's record_attended_session:
-- CREATE OR REPLACE with a different arg list creates a new overload
-- rather than replacing. Drops the now-redundant old-signature versions.
DROP FUNCTION IF EXISTS public.record_assessment_result(uuid, text, date, text);
DROP FUNCTION IF EXISTS public.complete_remediation_lesson(uuid, date, text);
