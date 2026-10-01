-- ============================================================================
-- Multi-centre Phase 1 — migration 007
-- Student centre transfers: the ONLY sanctioned way to change
-- students.centre_id.
--
-- Run LAST (after 002 created students.centre_id + student_centre_history).
-- Idempotent; safe to re-run. No existing row is deleted or rewritten.
--
-- ---------------------------------------------------------------------------
-- WHY AN RPC **AND** A GUARD TRIGGER (not one or the other)
-- ---------------------------------------------------------------------------
-- An RPC alone is NOT sufficient. RLS is a policy, and policies are only as
-- strong as the policies that exist right now. Today `students` has:
--     students_admin_all        FOR ALL  USING (is_admin())
--     students_read_instructors FOR SELECT ...
-- so no ordinary staff can UPDATE students at all. That is the correct
-- current state — but it is a property of the policy set, not of the data
-- model. If anyone later adds an instructor UPDATE policy on students (a very
-- plausible future change, e.g. to let instructors edit contact details), a
-- bare `UPDATE students SET centre_id = ...` would silently orphan
-- student_centre_history: the old stay would stay open forever and the unique
-- partial index (one open row per student) would then block every future
-- transfer for that student.
--
-- The trigger makes the invariant a property of the TABLE rather than of the
-- policy set, so it survives that future change. It is the belt; the RPC is
-- the braces. Either alone leaves a gap:
--   * RPC only  -> a future policy change opens a silent corruption path.
--   * trigger only -> every caller would have to reimplement close/open/update,
--                     and non-admins could not be prevented cleanly.
--
-- The trigger deliberately does NOT do the transfer itself. It rejects any
-- centre change that is not made from inside the RPC, identified by a
-- transaction-local GUC flag that only SECURITY DEFINER code can set for its
-- own transaction. This keeps the business logic in one readable place and
-- keeps the trigger a pure guard.
--
-- ---------------------------------------------------------------------------
-- WHAT THIS DOES NOT TOUCH
-- ---------------------------------------------------------------------------
-- attended_sessions.centre_id and attendance.centre_id are historical
-- snapshots and are never rewritten by a transfer. That is enforced separately
-- by the stamp_centre_from_student() trigger in migration 003, which rejects
-- any attempt to change either column on an existing row.
-- ============================================================================

-- ------------------------------------------------------- transfer RPC --------
-- Signature is new (no existing overload), so CREATE OR REPLACE cannot
-- collide. search_path pinned. Atomic: plpgsql runs the whole body in the
-- caller's transaction, so a failure at any step rolls back the lot.
CREATE OR REPLACE FUNCTION public.transfer_student_to_centre(
  in_student_id uuid,
  in_centre_id uuid,
  in_effective_date date DEFAULT CURRENT_DATE
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor            uuid;
  actor_name       text;
  current_centre   uuid;
  open_from        date;
BEGIN
  -- 1. Caller must be an admin. Transfers move a student between sites, which
  --    is a business/management decision, not a teaching one. Instructors are
  --    deliberately NOT given this power in Phase 1 -- if that is wanted it
  --    should be an explicit, separate decision rather than a side effect.
  SELECT p.id, p.name INTO actor, actor_name
  FROM public.profiles p
  WHERE p.auth_id = auth.uid() AND p.role = 'admin';

  IF actor IS NULL THEN
    RAISE EXCEPTION 'Only an administrator may transfer a student between centres';
  END IF;

  -- 2. The student must exist.
  SELECT s.centre_id INTO current_centre
  FROM public.students s
  WHERE s.id = in_student_id
  FOR UPDATE;                       -- serialise concurrent transfers

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Student not found';
  END IF;

  -- 3. The destination centre must exist AND be active. An inactive centre is
  --    not a valid destination even if the FK still resolves to it.
  IF NOT EXISTS (
    SELECT 1 FROM public.centres c WHERE c.id = in_centre_id AND c.active
  ) THEN
    RAISE EXCEPTION 'Destination centre does not exist or is not active';
  END IF;

  -- 4. Effective date sanity: cannot be in the future (this is a historical
  --    record, not a scheduling feature), and cannot precede the current stay.
  IF in_effective_date > CURRENT_DATE THEN
    RAISE EXCEPTION 'Transfer effective date cannot be in the future';
  END IF;

  IF in_effective_date < COALESCE(s.date_joined, CURRENT_DATE) THEN
    RAISE EXCEPTION 'Transfer effective date cannot be before the student joined';
  END IF;

  -- 5. No-op guard. Returning cleanly (rather than raising) means a retried
  --    request is safe and idempotent, which matters for a client that may
  --    double-submit.
  IF current_centre IS NOT DISTINCT FROM in_centre_id THEN
    RETURN;
  END IF;

  -- 6. Close the existing open stay. to_date is the day BEFORE the new stay
  --    begins, so the two stays do not overlap and no day is unaccounted for.
  SELECT h.from_date INTO open_from
  FROM public.student_centre_history h
  WHERE h.student_id = in_student_id AND h.to_date IS NULL;

  -- 6a. ADOPTION PATH: a student created without a centre (legacy rows, and
  --     anything StudentForm.tsx creates until Phase 2 makes the column NOT
  --     NULL) has no open stay to close. Transferring them to a centre is an
  --     "adoption", not a move: we simply open their first stay. Without this
  --     branch an admin could never repair a centre-less student through the
  --     sanctioned path, which would leave the NOT NULL migration in Part E
  --     with no clean remedy.
  IF open_from IS NULL THEN
    IF current_centre IS NOT NULL THEN
      RAISE EXCEPTION
        'No open centre history row for this student, but they have a centre set; repair student_centre_history before transferring';
    END IF;

    PERFORM set_config('robothink.centre_transfer', 'on', true);

    INSERT INTO public.student_centre_history (student_id, centre_id, from_date)
    VALUES (in_student_id, in_centre_id,
            GREATEST(in_effective_date, COALESCE(s.date_joined, in_effective_date)));

    UPDATE public.students SET centre_id = in_centre_id WHERE id = in_student_id;

    INSERT INTO public.audit_log (actor_id, actor_name, action, object_type, object_id, before, after)
    VALUES (actor, actor_name, 'adopt_centre', 'student', in_student_id::text,
            jsonb_build_object('centre_id', NULL),
            jsonb_build_object('centre_id', in_centre_id, 'effective_date', in_effective_date));
    RETURN;
  END IF;

  IF in_effective_date <= open_from THEN
    RAISE EXCEPTION
      'Transfer effective date (%) must be after the start of the current stay (%)',
      in_effective_date, open_from;
  END IF;

  -- 7. Set the guard flag so the BEFORE UPDATE trigger on students permits the
  --    centre change below and rejects it everywhere else. set_config with
  --    is_local=true scopes it to this transaction only, so it cannot leak to
  --    a later request on the same connection.
  PERFORM set_config('robothink.centre_transfer', 'on', true);

  -- 8. Close the current stay.
  UPDATE public.student_centre_history
  SET to_date = in_effective_date - 1
  WHERE student_id = in_student_id AND to_date IS NULL;

  -- 9. Open the new stay. The unique partial index guarantees at most one open
  --    row per student; step 8 closed the previous one, so this cannot fail on
  --    a re-run.
  INSERT INTO public.student_centre_history (student_id, centre_id, from_date)
  VALUES (in_student_id, in_centre_id, in_effective_date);

  -- 10. Move the student. Historical snapshots are deliberately NOT touched.
  UPDATE public.students
  SET centre_id = in_centre_id
  WHERE id = in_student_id;

  -- 11. Audit, using the EXISTING audit_log schema
  --     (actor_id, action, object_type, object_id, before, after), the same
  --     shape set_student_current_lesson already writes. No schema change.
  INSERT INTO public.audit_log (actor_id, actor_name, action, object_type, object_id, before, after)
  VALUES (
    actor,
    actor_name,
    'transfer_centre',
    'student',
    in_student_id::text,
    jsonb_build_object('centre_id', current_centre),
    jsonb_build_object('centre_id', in_centre_id, 'effective_date', in_effective_date)
  );
END;
$$;

-- ---------------------------------------------------------- guard trigger ----
-- Rejects a direct centre change on students.
--
-- Allowed ONLY when all of these hold:
--   * the caller is an admin (so even the RPC path cannot be entered by staff),
--   * the RPC has set the transaction-local flag,
--   * and the student_centre_history is actually consistent afterwards.
--
-- The last condition is the important one: it means even a bug in the RPC
-- cannot leave the student and their history disagreeing, because the trigger
-- re-verifies the invariant at the moment of the write rather than trusting
-- the caller.
CREATE OR REPLACE FUNCTION public.guard_student_centre_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  old_centre uuid;
  new_centre uuid;
BEGIN
  -- INSERT path: there is no OLD row. Only an admin may create a student with
  -- no centre (the trigger's WHEN clause decides whether we are even called).
  IF TG_OP = 'INSERT' THEN
    IF NOT public.is_admin() THEN
      RAISE EXCEPTION
        'A student must be created with a centre; only an administrator may create a centre-less student';
    END IF;
    RETURN NEW;
  END IF;

  old_centre := OLD.centre_id;
  new_centre := NEW.centre_id;

  IF new_centre IS NOT DISTINCT FROM old_centre THEN
    RETURN NEW;                     -- centre untouched: not our business
  END IF;

  IF current_setting('robothink.centre_transfer', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION
      'students.centre_id cannot be changed directly; use transfer_student_to_centre() instead';
  END IF;

  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only an administrator may transfer a student between centres';
  END IF;

  -- Moving a student to "no centre" is not a transfer. Only the Phase 1
  -- backfill may produce a centre-less student, and that runs before this
  -- trigger exists.
  IF new_centre IS NULL THEN
    RAISE EXCEPTION 'A student cannot be moved to a NULL centre';
  END IF;

  -- The RPC must already have opened a stay at the new centre, otherwise the
  -- student and their history would disagree.
  IF NOT EXISTS (
    SELECT 1
    FROM public.student_centre_history h
    WHERE h.student_id = NEW.id
      AND h.centre_id = new_centre
      AND h.to_date IS NULL
  ) THEN
    RAISE EXCEPTION
      'Refusing centre change: no open student_centre_history row for the destination centre';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS students_guard_centre_change ON public.students;
CREATE TRIGGER students_guard_centre_change
  BEFORE UPDATE OF centre_id ON public.students
  FOR EACH ROW EXECUTE FUNCTION public.guard_student_centre_change();

-- ------------------------------------------- fail-closed on centre-less rows --
-- Item 2 of the review: the column stays NULLABLE (StudentForm.tsx inserts
-- students without a centre), so NULL must be handled by policy rather than by
-- a constraint.
--
-- RLS already fails closed for reads: can_access_student() treats a NULL-centre
-- student as admin-only, and students_read_instructors requires
-- can_access_student(). So a centre-less student is invisible to instructors and
-- management, and visible to admins only.
--
-- Writes are closed here. Ordinary staff cannot create a centre-less student
-- (students has no INSERT policy for non-admins at all) and cannot move a
-- student to NULL (the trigger above). Admins keep full control for legacy
-- data: this trigger deliberately does not fire for admins on the INSERT path,
-- so an admin can still create a centre-less student if they must.
--
-- PHASE 2 MUST DO: once the frontend always supplies a valid centre, run
--     ALTER TABLE public.students ALTER COLUMN centre_id SET NOT NULL;
-- and backstop any remaining NULLs first:
--     SELECT id, full_name FROM public.students WHERE centre_id IS NULL;
-- They can then be given a real centre via transfer_student_to_centre() or an
-- admin-only UPDATE plus a matching student_centre_history row.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'students_guard_centre_not_null_insert'
  ) THEN
    CREATE TRIGGER students_guard_centre_not_null_insert
      BEFORE INSERT ON public.students
      FOR EACH ROW
      WHEN (NEW.centre_id IS NULL AND public.is_admin() IS NOT TRUE)
      EXECUTE FUNCTION public.guard_student_centre_change();
  END IF;
END $$;

-- ------------------------------------------------------------- privileges ----
-- Same reasoning as migration 005: SECURITY DEFINER + default PUBLIC execute
-- would let anon call a function that moves students between centres.
REVOKE ALL ON FUNCTION public.transfer_student_to_centre(uuid, uuid, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.transfer_student_to_centre(uuid, uuid, date)
  TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.guard_student_centre_change() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.guard_student_centre_change() TO service_role;