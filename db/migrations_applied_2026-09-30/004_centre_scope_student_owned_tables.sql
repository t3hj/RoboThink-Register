-- Multi-centre Phase 1 — centre-scope the remaining student-owned tables.
--
-- Model: these tables derive centre through the student (can_access_student),
-- NOT through their own centre column — lesson_records is the progression
-- ledger keyed by student, feedback_sheets/assessments/remediation_lessons are
-- tied to a session or student, and student_schedules/term_time_followups/
-- progress_overrides/daily_awards are student-operational. Existing write
-- surfaces are preserved exactly (same roles, same delete rules); only the
-- read/write predicates gain a centre condition.
--
-- daily_awards is special: it may reference TWO students (builder_id,
-- coder_id, either nullable). It is centre-scoped only when both present
-- students are accessible; a NULL student on either side means that side is
-- simply not restricted (row may have no builder or no coder).
--
-- The only existing policy name changes are for term_time_followups
-- (management read gains centre scoping; it previously saw everything).
--
-- Idempotent. Run AFTER 001-003.

-- ---------------------------------------------------------- lesson_records ----
DROP POLICY IF EXISTS lesson_records_select_staff ON public.lesson_records;
CREATE POLICY lesson_records_select_staff ON public.lesson_records
  FOR SELECT
  USING (
    (public.is_admin() OR public.is_instructor() OR public.is_management())
    AND public.can_access_student(student_id)
  );

DROP POLICY IF EXISTS lesson_records_insert_staff ON public.lesson_records;
CREATE POLICY lesson_records_insert_staff ON public.lesson_records
  FOR INSERT
  WITH CHECK (
    (public.is_admin() OR public.is_instructor())
    AND (
      instructor_id IS NULL
      OR instructor_id = (SELECT id FROM public.profiles WHERE auth_id = auth.uid()::uuid)
      OR public.is_admin()
    )
    AND public.can_access_student(student_id)
  );

DROP POLICY IF EXISTS lesson_records_update_staff ON public.lesson_records;
CREATE POLICY lesson_records_update_staff ON public.lesson_records
  FOR UPDATE
  USING (
    (public.is_admin() OR public.is_instructor())
    AND (
      instructor_id IS NULL
      OR instructor_id = (SELECT id FROM public.profiles WHERE auth_id = auth.uid()::uuid)
      OR public.is_admin()
    )
    AND public.can_access_student(student_id)
  )
  WITH CHECK (
    (public.is_admin() OR public.is_instructor())
    AND (
      instructor_id IS NULL
      OR instructor_id = (SELECT id FROM public.profiles WHERE auth_id = auth.uid()::uuid)
      OR public.is_admin()
    )
    AND public.can_access_student(student_id)
  );

-- lesson_records_delete_admin (migration_001) is admin-global by design; kept.

-- --------------------------------------------------------- feedback_sheets ----
DROP POLICY IF EXISTS feedback_sheets_select_staff ON public.feedback_sheets;
CREATE POLICY feedback_sheets_select_staff ON public.feedback_sheets
  FOR SELECT
  USING (
    (public.is_admin() OR public.is_instructor() OR public.is_management())
    AND public.can_access_student(student_id)
  );

DROP POLICY IF EXISTS feedback_sheets_insert_staff ON public.feedback_sheets;
CREATE POLICY feedback_sheets_insert_staff ON public.feedback_sheets
  FOR INSERT
  WITH CHECK ((public.is_admin() OR public.is_instructor()) AND public.can_access_student(student_id));

DROP POLICY IF EXISTS feedback_sheets_update_staff ON public.feedback_sheets;
CREATE POLICY feedback_sheets_update_staff ON public.feedback_sheets
  FOR UPDATE
  USING ((public.is_admin() OR public.is_instructor()) AND public.can_access_student(student_id))
  WITH CHECK ((public.is_admin() OR public.is_instructor()) AND public.can_access_student(student_id));

-- ------------------------------------------------------------- assessments ----
DROP POLICY IF EXISTS assessments_select_staff ON public.assessments;
CREATE POLICY assessments_select_staff ON public.assessments
  FOR SELECT
  USING (
    (public.is_admin() OR public.is_instructor() OR public.is_management())
    AND public.can_access_student(student_id)
  );

DROP POLICY IF EXISTS assessments_insert_staff ON public.assessments;
CREATE POLICY assessments_insert_staff ON public.assessments
  FOR INSERT
  WITH CHECK (
    (public.is_admin() OR public.is_instructor())
    AND (
      instructor_id IS NULL
      OR instructor_id = (SELECT id FROM public.profiles WHERE auth_id = auth.uid()::uuid)
      OR public.is_admin()
    )
    AND public.can_access_student(student_id)
  );

DROP POLICY IF EXISTS assessments_update_staff ON public.assessments;
CREATE POLICY assessments_update_staff ON public.assessments
  FOR UPDATE
  USING (
    (public.is_admin() OR public.is_instructor())
    AND (
      instructor_id IS NULL
      OR instructor_id = (SELECT id FROM public.profiles WHERE auth_id = auth.uid()::uuid)
      OR public.is_admin()
    )
    AND public.can_access_student(student_id)
  )
  WITH CHECK (
    (public.is_admin() OR public.is_instructor())
    AND (
      instructor_id IS NULL
      OR instructor_id = (SELECT id FROM public.profiles WHERE auth_id = auth.uid()::uuid)
      OR public.is_admin()
    )
    AND public.can_access_student(student_id)
  );

-- ------------------------------------------------- remediation (read-only) ----
-- Writes happen inside SECURITY DEFINER RPCs (hardened in 005); the existing
-- surface had SELECT-only policies, which is preserved.
DROP POLICY IF EXISTS remediation_plans_select_staff ON public.remediation_plans;
CREATE POLICY remediation_plans_select_staff ON public.remediation_plans
  FOR SELECT
  USING (
    (public.is_admin() OR public.is_instructor() OR public.is_management())
    AND public.can_access_student(student_id)
  );

DROP POLICY IF EXISTS remediation_lessons_select_staff ON public.remediation_lessons;
CREATE POLICY remediation_lessons_select_staff ON public.remediation_lessons
  FOR SELECT
  USING (
    (public.is_admin() OR public.is_instructor() OR public.is_management())
    AND public.can_access_student(student_id)
  );

-- ---------------------------------------------------- student_schedules ------
DROP POLICY IF EXISTS student_schedules_select_staff ON public.student_schedules;
CREATE POLICY student_schedules_select_staff ON public.student_schedules
  FOR SELECT
  USING (
    (public.is_admin() OR public.is_instructor() OR public.is_management())
    AND public.can_access_student(student_id)
  );

-- --------------------------------------------------- progress_overrides ------
-- Was admin-only ALL (overrides_admin_only); admin is global by design.
-- Admin-only means no cross-centre leak, so the original policy is sufficient.
-- Kept unchanged.

-- --------------------------------------------------- term_time_followups -----
DROP POLICY IF EXISTS term_time_followups_select ON public.term_time_followups;
CREATE POLICY term_time_followups_select ON public.term_time_followups
  FOR SELECT
  USING (
    public.is_admin()
    OR (public.is_management() AND public.can_access_student(student_id))
  );

-- term_time_followups_admin_write (admin ALL) kept as-is.

-- --------------------------------------------------------- daily_awards -------
DROP POLICY IF EXISTS daily_awards_select_staff ON public.daily_awards;
CREATE POLICY daily_awards_select_staff ON public.daily_awards
  FOR SELECT
  USING (
    (public.is_admin() OR public.is_instructor() OR public.is_management())
    AND (builder_id IS NULL OR public.can_access_student(builder_id))
    AND (coder_id IS NULL OR public.can_access_student(coder_id))
  );

DROP POLICY IF EXISTS daily_awards_insert_staff ON public.daily_awards;
CREATE POLICY daily_awards_insert_staff ON public.daily_awards
  FOR INSERT
  WITH CHECK (
    (public.is_admin() OR public.is_instructor())
    AND (
      recorded_by IS NULL
      OR recorded_by = (SELECT id FROM public.profiles WHERE auth_id = auth.uid()::uuid)
      OR public.is_admin()
    )
    AND (builder_id IS NULL OR public.can_access_student(builder_id))
    AND (coder_id IS NULL OR public.can_access_student(coder_id))
  );

DROP POLICY IF EXISTS daily_awards_update_staff ON public.daily_awards;
CREATE POLICY daily_awards_update_staff ON public.daily_awards
  FOR UPDATE
  USING (
    (public.is_admin() OR public.is_instructor())
    AND (builder_id IS NULL OR public.can_access_student(builder_id))
    AND (coder_id IS NULL OR public.can_access_student(coder_id))
  )
  WITH CHECK (
    (public.is_admin() OR public.is_instructor())
    AND (builder_id IS NULL OR public.can_access_student(builder_id))
    AND (coder_id IS NULL OR public.can_access_student(coder_id))
  );

-- ------------------------------------------- curriculum_progression_log ------
DROP POLICY IF EXISTS curriculum_progression_log_select_staff ON public.curriculum_progression_log;
CREATE POLICY curriculum_progression_log_select_staff ON public.curriculum_progression_log
  FOR SELECT
  USING (
    (public.is_admin() OR public.is_instructor() OR public.is_management())
    AND public.can_access_student(student_id)
  );
