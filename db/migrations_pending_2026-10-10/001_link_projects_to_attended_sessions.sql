-- Pending migration: apply to the live Supabase project before deploying the
-- frontend changes that link a session to the project worked on that day.

ALTER TABLE public.attended_sessions
  ADD COLUMN project_id uuid REFERENCES public.student_projects(id) ON DELETE SET NULL;

CREATE INDEX attended_sessions_project_id_idx
  ON public.attended_sessions(project_id)
  WHERE project_id IS NOT NULL;

-- A project linked to a session must belong to that session's student. The
-- existing attended_sessions RLS policies still control who may update the
-- session; this trigger enforces the cross-table ownership invariant.
CREATE OR REPLACE FUNCTION public.ensure_attended_session_project_owner()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.project_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.student_projects p
    WHERE p.id = NEW.project_id
      AND p.student_id = NEW.student_id
  ) THEN
    RAISE EXCEPTION 'Project must belong to the same student as the attended session';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER attended_sessions_project_owner_check
BEFORE INSERT OR UPDATE OF project_id, student_id
ON public.attended_sessions
FOR EACH ROW
EXECUTE FUNCTION public.ensure_attended_session_project_owner();
