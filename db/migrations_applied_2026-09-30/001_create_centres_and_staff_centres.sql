-- Multi-centre Phase 1 — centres, staff_centres, centre-access helpers.
-- Run FIRST in the Supabase SQL Editor. Idempotent; safe to re-run.
-- No existing table is altered or dropped by this file.
--
-- 1) centres + staff_centres (many staff -> many centres, composite PK prevents
--    duplicate assignments).
-- 2) Seed the only existing centre: Stanmore Discovery Centre.
-- 3) Reusable centre-access helpers used by every centre-scoped RLS policy and
--    SECURITY DEFINER RPC check that follows (migrations 002-005):
--      user_centre_ids()            -> setof uuid: every centre the caller may act in
--      can_access_centre(uuid)      -> boolean: may the caller act in this centre
--      current_student_centre(uuid) -> uuid: a student's CURRENT centre
--      can_access_student(uuid)     -> boolean (NULL-centre students = admin only)
--
-- WHY SECURITY DEFINER IS REQUIRED HERE (not just preferred):
--   A policy on `students` calls can_access_centre(), which reads profiles and
--   staff_centres. If that read went through those tables' own RLS, a policy
--   could evaluate back into itself. is_admin() is already SECURITY DEFINER, but
--   staff_centres is not, so we do the read ourselves: no recursion is possible
--   because none of these helpers reads a table whose policy calls back into it.
-- search_path is pinned to public on every definer function (Supabase Advisor:
-- "function search_path mutable").
-- Roles are UNCHANGED: admin / instructor / management. No Master role.

-- ---------------------------------------------------------------- centres ----
CREATE TABLE IF NOT EXISTS public.centres (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.centres (name)
SELECT 'Stanmore Discovery Centre'
WHERE NOT EXISTS (SELECT 1 FROM public.centres WHERE name = 'Stanmore Discovery Centre');

-- ------------------------------------------------------------ staff_centres ---
CREATE TABLE IF NOT EXISTS public.staff_centres (
  staff_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  centre_id uuid NOT NULL REFERENCES public.centres(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (staff_id, centre_id) -- prevents duplicate assignments
);

CREATE INDEX IF NOT EXISTS staff_centres_centre_id_idx ON public.staff_centres(centre_id);
-- staff_id is covered by the composite primary key.

-- --------------------------------------------------- centre-access helpers ----
-- ORDERING — THE FIX FOR SQLSTATE 42883:
-- These functions MUST be created BEFORE any policy that calls them.
-- PostgreSQL validates a policy's USING expression at CREATE POLICY time, so
-- "CREATE POLICY ... USING (id IN (SELECT public.user_centre_ids()))" fails
-- immediately with "function public.user_centre_ids() does not exist" if the
-- function is defined further down the file. The tables come first (the
-- functions reference them), then the functions, then every policy.
--
-- user_centre_ids()      -> setof uuid: every centre the caller may act in.
--                           Admins get all of them; everyone else gets only the
--                           centres they are explicitly assigned to.
-- can_access_centre(id)  -> boolean: may the caller act in this centre?
--
-- current_student_centre() and can_access_student() are NOT defined here: they
-- read students.centre_id, which migration 002 has not added yet. PostgreSQL
-- parses a SQL function body at CREATE time, so defining them now would fail
-- with "column s.centre_id does not exist" (SQLSTATE 42703). They are created
-- in 002, after the column exists and before any policy calls them. user_centre_ids() -> setof uuid: every centre the caller may act in.
--                    Admins get all of them; everyone else gets only the
--                    centres they are explicitly assigned to.
CREATE OR REPLACE FUNCTION public.user_centre_ids()
RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT c.id
  FROM public.centres c
  WHERE public.is_admin()
     OR EXISTS (
       SELECT 1
       FROM public.profiles p
       JOIN public.staff_centres sc ON sc.staff_id = p.id
       WHERE p.auth_id = auth.uid() AND sc.centre_id = c.id
     );
$$;

CREATE OR REPLACE FUNCTION public.can_access_centre(in_centre uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT in_centre IS NOT NULL AND (
    public.is_admin()
    OR EXISTS (
      SELECT 1
      FROM public.profiles p
      JOIN public.staff_centres sc ON sc.staff_id = p.id
      WHERE p.auth_id = auth.uid() AND sc.centre_id = in_centre
    )
  );
$$;

-- current_student_centre() and can_access_student() are NOT defined here.
-- They read students.centre_id, which migration 002 has not added yet, and
-- PostgreSQL parses a SQL function body at CREATE time, so defining them now
-- would fail with "column s.centre_id does not exist" (SQLSTATE 42703).
-- They are created in 002, once the column exists.

-- --------------------------------------------------- RLS on the new tables ---
-- Policies come last, because each one calls a helper defined above and
-- PostgreSQL resolves those at CREATE POLICY time.
ALTER TABLE public.centres       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_centres ENABLE ROW LEVEL SECURITY;

-- Staff may only SEE the centres they are assigned to (admins see all).
-- Deliberately NOT "any staff sees every centre": that would leak the centre
-- list to instructors assigned elsewhere.
DROP POLICY IF EXISTS centres_select_staff ON public.centres;
CREATE POLICY centres_select_staff ON public.centres
  FOR SELECT
  USING (public.is_admin() OR id IN (SELECT public.user_centre_ids()));

DROP POLICY IF EXISTS centres_admin_write ON public.centres;
CREATE POLICY centres_admin_write ON public.centres
  FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- Admins manage assignments; each user can read their own assignments
-- (needed for the future centre selector; also readable by admins).
DROP POLICY IF EXISTS staff_centres_admin_all ON public.staff_centres;
CREATE POLICY staff_centres_admin_all ON public.staff_centres
  FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS staff_centres_select_own ON public.staff_centres;
CREATE POLICY staff_centres_select_own ON public.staff_centres
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = staff_centres.staff_id AND p.auth_id = auth.uid()
    )
  );

-- ------------------------------------------------------- grants / privileges ---
GRANT SELECT, INSERT, UPDATE, DELETE ON public.centres       TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.staff_centres TO authenticated;
GRANT SELECT ON public.centres, public.staff_centres TO service_role;

REVOKE ALL ON FUNCTION public.user_centre_ids()            FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_access_centre(uuid)       FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.user_centre_ids()            TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_access_centre(uuid)       TO authenticated, service_role;

-- --------------------------------------------------- Stanmore staff backfill --
-- SAFETY-CRITICAL: every profile that existed before this migration worked at
-- Stanmore. Without this, can_access_centre() is false for all of them and the
-- moment any centre-scoped policy lands (migration 002) every existing
-- instructor and manager silently sees an empty app.
--
-- Scope is deliberately EXACT: only profiles whose auth_id is populated, i.e.
-- people who can actually sign in. Rows in profiles with a NULL auth_id are
-- seeded/placeholder profiles that never authenticate, so they are skipped --
-- but note the consequence (see report item I): such a profile, once mapped to
-- a real auth user, has NO centre assignment and must be added by an admin.
-- It is left for an admin to assign rather than guessed at here.
INSERT INTO public.staff_centres (staff_id, centre_id)
SELECT p.id, c.id
FROM public.profiles p
CROSS JOIN public.centres c
WHERE c.name = 'Stanmore Discovery Centre'
  AND p.auth_id IS NOT NULL
ON CONFLICT (staff_id, centre_id) DO NOTHING;
