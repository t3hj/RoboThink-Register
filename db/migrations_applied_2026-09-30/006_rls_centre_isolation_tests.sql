-- ============================================================================
-- MULTI-CENTRE PHASE 1 - OWNER-SAFE DATABASE TESTS
-- ============================================================================
-- Run in the Supabase SQL Editor AFTER migrations 001-005 and 007.
--
-- This script deliberately runs as the SQL Editor/database owner. It creates
-- only TEST-prefixed rows inside one transaction and always ends with ROLLBACK.
-- It does not set request.jwt.claims, request.jwt.claim.sub, SET ROLE, or use
-- service-role privileges to impersonate a user.
--
-- IMPORTANT AUTH LIMITATION
-- -------------------------
-- `auth.uid()` is derived from the real Supabase Auth request context. A SQL
-- Editor owner session is not a signed-in browser session. Setting arbitrary
-- request.* GUC values, even together with SET ROLE authenticated, is not a
-- supported way to establish the identity used by this project's auth.uid().
-- It also cannot make an owner session a meaningful RLS test: the table owner
-- bypasses RLS.
--
-- Therefore this file tests the guarantees that are meaningful as the owner:
--   * TEST centre/staff/student/history fixture relationships
--   * staff-centre uniqueness and one-open-history-row invariant
--   * attendance and attended-session centre snapshots
--   * direct students.centre_id changes, including NULL, are blocked
--   * owner/unauthenticated calls to the transfer RPC fail closed before any
--     transfer work (inactive-destination validation is in the admin procedure)
--   * the transfer trigger and other owner-visible constraints
--
-- It does NOT claim to test as an instructor or admin:
--   * RLS visibility or write isolation
--   * dual-centre visibility
--   * anon/no-access RLS denial
--   * user_centre_ids(), can_access_centre(), or can_access_student() for a
--     real caller
--   * a successful transfer through the admin-only RPC
--
-- Run the real-user procedure at the end of this file with actual Supabase
-- Auth users/sessions. The TEST profile/auth IDs below are transaction-local
-- fixtures and are not usable browser identities after this ROLLBACK.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- TEST fixtures
-- ---------------------------------------------------------------------------
INSERT INTO public.centres (name)
VALUES ('TEST Hornsey Centre')
ON CONFLICT (name) DO NOTHING;

INSERT INTO public.profiles (id, auth_id, name, email, role) VALUES
  ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-1111-1111-1111-111111111111',
   'TEST Stanmore Instructor', 'test-stanmore-instructor@example.invalid', 'instructor'),
  ('11111111-1111-1111-1111-111111111112', 'aaaaaaaa-1111-1111-1111-111111111112',
   'TEST Dual Instructor', 'test-dual-instructor@example.invalid', 'instructor'),
  ('11111111-1111-1111-1111-111111111113', 'aaaaaaaa-1111-1111-1111-111111111113',
   'TEST Admin', 'test-admin@example.invalid', 'admin')
  ON CONFLICT (id) DO UPDATE
  SET auth_id = EXCLUDED.auth_id,
      name = EXCLUDED.name,
      email = EXCLUDED.email,
      role = EXCLUDED.role;

INSERT INTO public.staff_centres (staff_id, centre_id)
  SELECT p.id, c.id
  FROM public.profiles AS p
JOIN public.centres c ON c.name IN ('Stanmore Discovery Centre', 'TEST Hornsey Centre')
  WHERE p.id IN ('11111111-1111-1111-1111-111111111111',
        '11111111-1111-1111-1111-111111111112')
    AND (p.id <> '11111111-1111-1111-1111-111111111111'
      OR c.name = 'Stanmore Discovery Centre')
ON CONFLICT DO NOTHING;

DO $$
DECLARE
  v_level_id integer;
  v_lesson_id uuid;
BEGIN
  SELECT min(id) INTO v_level_id FROM public.levels;
  IF v_level_id IS NULL THEN
    RAISE EXCEPTION 'FIXTURE SETUP FAILED: no levels exist';
  END IF;

  -- lessons.id is uuid; PostgreSQL has no min(uuid).
  SELECT l.id INTO v_lesson_id
  FROM public.lessons AS l
  WHERE l.lesson_kind = 'normal'
  ORDER BY l.level_id, l.lesson_number
  LIMIT 1;
  IF v_lesson_id IS NULL THEN
    RAISE EXCEPTION 'FIXTURE SETUP FAILED: no normal lessons exist';
  END IF;

  INSERT INTO public.students
    (id, full_name, current_level_id, current_lesson_id, centre_id)
  SELECT '22222222-2222-2222-2222-222222222201', 'TEST Stanmore Student',
         v_level_id, v_lesson_id, c.id
  FROM public.centres c
  WHERE c.name = 'Stanmore Discovery Centre'
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.students
    (id, full_name, current_level_id, current_lesson_id, centre_id)
  SELECT '22222222-2222-2222-2222-222222222202', 'TEST Hornsey Student',
         v_level_id, v_lesson_id, c.id
  FROM public.centres c
  WHERE c.name = 'TEST Hornsey Centre'
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.student_centre_history (student_id, centre_id, from_date)
  SELECT s.id, s.centre_id, COALESCE(s.date_joined, CURRENT_DATE)
  FROM public.students s
  WHERE s.id IN ('22222222-2222-2222-2222-222222222201',
                 '22222222-2222-2222-2222-222222222202')
    AND s.centre_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.student_centre_history h
      WHERE h.student_id = s.id AND h.to_date IS NULL
    );
END $$;

-- ---------------------------------------------------------------------------
-- Fixture integrity and owner-safe schema assertions
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  stanmore uuid;
  hornsey uuid;
  assigned_count integer;
  student_count integer;
BEGIN
  SELECT id INTO stanmore FROM public.centres WHERE name = 'Stanmore Discovery Centre';
  SELECT id INTO hornsey FROM public.centres WHERE name = 'TEST Hornsey Centre';
  IF stanmore IS NULL OR hornsey IS NULL THEN
    RAISE EXCEPTION 'FIXTURE SETUP FAILED: required TEST/existing centre is missing';
  END IF;

  SELECT count(*) INTO student_count
  FROM public.students
  WHERE id IN ('22222222-2222-2222-2222-222222222201',
               '22222222-2222-2222-2222-222222222202');
  IF student_count <> 2 THEN
    RAISE EXCEPTION 'FIXTURE SETUP FAILED: expected 2 test students, found %', student_count;
  END IF;

  SELECT count(*) INTO assigned_count
  FROM public.staff_centres sc
  WHERE sc.staff_id IN ('11111111-1111-1111-1111-111111111111',
                        '11111111-1111-1111-1111-111111111112');
  IF assigned_count <> 3 THEN
    RAISE EXCEPTION 'FIXTURE SETUP FAILED: expected 3 staff-centre rows, found %', assigned_count;
  END IF;

  IF (SELECT count(*) FROM public.student_centre_history
      WHERE student_id IN ('22222222-2222-2222-2222-222222222201',
                           '22222222-2222-2222-2222-222222222202')
        AND to_date IS NULL) <> 2 THEN
    RAISE EXCEPTION 'TEST FAILED: each TEST student must have one open centre stay';
  END IF;
END $$;

DO $$
DECLARE
  stanmore uuid;
  staff_id uuid;
  duplicate_blocked boolean := false;
BEGIN
  SELECT id INTO stanmore FROM public.centres WHERE name = 'Stanmore Discovery Centre';
  SELECT id INTO staff_id FROM public.profiles
  WHERE id = '11111111-1111-1111-1111-111111111111';
  BEGIN
    INSERT INTO public.staff_centres (staff_id, centre_id) VALUES (staff_id, stanmore);
  EXCEPTION WHEN unique_violation THEN
    duplicate_blocked := true;
  END;
  IF NOT duplicate_blocked THEN
    RAISE EXCEPTION 'TEST FAILED: duplicate staff-centre assignment was accepted';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Historical snapshot triggers
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  stanmore uuid;
  hornsey uuid;
  session_id uuid;
  attendance_centre uuid;
  blocked boolean := false;
BEGIN
  SELECT id INTO stanmore FROM public.centres WHERE name = 'Stanmore Discovery Centre';
  SELECT id INTO hornsey FROM public.centres WHERE name = 'TEST Hornsey Centre';

  INSERT INTO public.attended_sessions
    (student_id, date, session_number, actual_lesson_id, outcome, centre_id)
  VALUES (
    '22222222-2222-2222-2222-222222222201', CURRENT_DATE, 999,
    (SELECT id FROM public.lessons WHERE lesson_kind = 'normal'
     ORDER BY level_id, lesson_number LIMIT 1),
    'not_finished', hornsey)
  RETURNING id INTO session_id;

  IF (SELECT centre_id FROM public.attended_sessions WHERE id = session_id)
       IS DISTINCT FROM stanmore THEN
    RAISE EXCEPTION 'TEST FAILED: attended-session centre was not stamped from the student';
  END IF;

  BEGIN
    UPDATE public.attended_sessions SET centre_id = hornsey WHERE id = session_id;
  EXCEPTION WHEN OTHERS THEN
    blocked := true;
  END;
  IF NOT blocked THEN
    RAISE EXCEPTION 'TEST FAILED: historical attended-session centre was changed';
  END IF;

  INSERT INTO public.attendance
    (student_id, date, status, centre_id)
  VALUES ('22222222-2222-2222-2222-222222222202', CURRENT_DATE, 'Arrived', NULL);

  SELECT centre_id INTO attendance_centre
  FROM public.attendance
  WHERE student_id = '22222222-2222-2222-2222-222222222202'
    AND date = CURRENT_DATE;
  IF attendance_centre IS DISTINCT FROM hornsey THEN
    RAISE EXCEPTION 'TEST FAILED: attendance centre was not stamped from the student';
  END IF;

  blocked := false;
  BEGIN
    UPDATE public.attendance
    SET centre_id = stanmore
    WHERE student_id = '22222222-2222-2222-2222-222222222202'
      AND date = CURRENT_DATE;
  EXCEPTION WHEN OTHERS THEN
    blocked := true;
  END;
  IF NOT blocked THEN
    RAISE EXCEPTION 'TEST FAILED: historical attendance centre was changed';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Student centre guard and history invariants
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  stanmore uuid;
  hornsey uuid;
  before_centre uuid;
  blocked boolean := false;
BEGIN
  SELECT id INTO stanmore FROM public.centres WHERE name = 'Stanmore Discovery Centre';
  SELECT id INTO hornsey FROM public.centres WHERE name = 'TEST Hornsey Centre';
  SELECT centre_id INTO before_centre FROM public.students
  WHERE id = '22222222-2222-2222-2222-222222222201';

  IF before_centre IS DISTINCT FROM stanmore THEN
    RAISE EXCEPTION 'FIXTURE SETUP FAILED: Stanmore test student is not at Stanmore';
  END IF;

  BEGIN
    UPDATE public.students SET centre_id = hornsey
    WHERE id = '22222222-2222-2222-2222-222222222201';
  EXCEPTION WHEN OTHERS THEN
    blocked := true;
  END;
  IF NOT blocked THEN
    RAISE EXCEPTION 'TEST FAILED: direct students.centre_id change was allowed';
  END IF;
  IF (SELECT centre_id FROM public.students
      WHERE id = '22222222-2222-2222-2222-222222222201') IS DISTINCT FROM before_centre THEN
    RAISE EXCEPTION 'TEST FAILED: rejected direct centre change modified the student';
  END IF;

  blocked := false;
  BEGIN
    UPDATE public.students SET centre_id = NULL
    WHERE id = '22222222-2222-2222-2222-222222222201';
  EXCEPTION WHEN OTHERS THEN
    blocked := true;
  END;
  IF NOT blocked THEN
    RAISE EXCEPTION 'TEST FAILED: direct move to NULL centre was allowed';
  END IF;
END $$;

DO $$
DECLARE
  duplicate_blocked boolean := false;
BEGIN
  BEGIN
    INSERT INTO public.student_centre_history
      (student_id, centre_id, from_date)
    SELECT student_id, centre_id, CURRENT_DATE
    FROM public.student_centre_history
    WHERE student_id = '22222222-2222-2222-2222-222222222201'
      AND to_date IS NULL;
  EXCEPTION WHEN unique_violation THEN
    duplicate_blocked := true;
  END;
  IF NOT duplicate_blocked THEN
    RAISE EXCEPTION 'TEST FAILED: a student received two open centre-history rows';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Transfer RPC fail-closed checks possible without a real Auth session
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  closed_centre uuid;
  blocked boolean := false;
BEGIN
  INSERT INTO public.centres (name, active)
  VALUES ('TEST Closed Centre', false)
  ON CONFLICT (name) DO UPDATE SET active = false;
  SELECT id INTO closed_centre FROM public.centres WHERE name = 'TEST Closed Centre';

  -- The owner/SQL Editor has no real admin JWT. The RPC must reject it before
  -- any transfer work; this is an owner-safe check of the admin-only boundary.
  BEGIN
    PERFORM public.transfer_student_to_centre(
      '22222222-2222-2222-2222-222222222201', closed_centre, CURRENT_DATE);
  EXCEPTION WHEN OTHERS THEN
    blocked := true;
  END;
  IF NOT blocked THEN
    RAISE EXCEPTION 'TEST FAILED: unauthenticated owner call reached transfer logic';
  END IF;
END $$;

SELECT 'OWNER-SAFE CENTRE TESTS PASSED. RLS visibility, per-caller helpers, '
       || 'positive admin transfer, and instructor/anon denial require the '
       || 'real authenticated-session procedure below.';

-- Every TEST row and all test-only changes are discarded.
ROLLBACK;

-- ============================================================================
-- REAL AUTHENTICATED-SESSION PROCEDURE (run separately, not in this transaction)
-- ============================================================================
-- 1. In Supabase Auth, create/sign in actual users for a Stanmore instructor,
--    dual-centre instructor, and admin. Ensure each user's auth.users.id is the
--    same UUID stored in profiles.auth_id, and assign staff_centres rows as
--    needed. Do not use the transaction-local fake auth IDs above as browser
--    identities.
-- 2. Through the app using the anon key, sign in as the Stanmore-only instructor:
--      - assigned-centre students are visible;
--      - other-centre students and their profiles are not visible;
--      - an UPDATE of another-centre student affects zero rows;
--      - record_attended_session and set_student_current_lesson for the other
--        centre fail;
--      - transfer_student_to_centre fails with the admin-only error.
-- 3. Sign in as the dual-centre instructor and verify both assigned centres are
--    visible, while an unassigned centre is not. Verify user_centre_ids(),
--    can_access_centre(), and can_access_student() through authenticated RPC
--    calls or the app's equivalent queries.
-- 4. Sign in as the admin and verify all centres/students are visible. Transfer
--    a TEST student with transfer_student_to_centre(), then verify the old
--    history row closes the day before, one new row is open, and existing
--    attended_sessions/attendance centre snapshots are unchanged. Attempt a
--    transfer to an inactive TEST centre and verify it is rejected. Verify a
--    direct students.centre_id update still fails.
-- 5. Sign out and use an unauthenticated anon client. Verify students, centres,
--    staff_centres, and the centre-scoped tables return no rows and protected
--    RPCs are unavailable or reject the request.