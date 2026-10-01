# Multi-centre Phase 1 — migration set (2026-09-30)

> **APPLIED AND OWNER-SAFE TESTS PASSED.** Migrations `001`-`005` and `007`
> have been applied successfully to the live Supabase project. The owner-safe
> `006_rls_centre_isolation_tests.sql` script has also been run successfully,
> and its tests passed. The real authenticated-session RLS checks in Part C
> still need to be completed. The frontend Phase 2 work (centre selector,
> staff-centre assignment UI, student transfer UI, and related workflows) has
> not yet been implemented.

## Execution order (Supabase SQL Editor, one file at a time)

| # | File | Depends on |
|---|------|-----------|
| 1 | `001_create_centres_and_staff_centres.sql` | existing schema + `is_admin()`/`is_instructor()`/`is_management()` |
| 2 | `002_students_centre_id_and_history.sql` | 001 |
| 3 | `003_attended_sessions_and_attendance_centre.sql` | 002 |
| 4 | `004_centre_scope_student_owned_tables.sql` | 001 (helpers), 002 |
| 5 | `005_harden_rpcs_centre_checks.sql` | 001 (helpers), 003 (`attended_sessions.centre_id`) |
| 6 | `007_student_centre_transfer.sql` | 002 (`students.centre_id`, `student_centre_history`) |
| 7 | `006_rls_centre_isolation_tests.sql` | 001–005 + 007 — **tests, run last** |

`007` is numbered after `006` for history, but must be applied **before** the
tests run. Every file is idempotent: re-running any of them produces the same
end state.

### The two ordering constraints that matter

1. **`001` before `002`.** `001` seeds `staff_centres` for every profile with a
   populated `auth_id`. `002` is where the centre-scoped `students` policy first
   takes effect. If the staff rows were missing at that moment, every existing
   instructor would see an empty app.
2. **`007` before any test run.** Until the guard trigger exists,
   `students.centre_id` can still be changed directly.

## Part A — migrations applied in the SQL Editor as the database owner

Migrations `001`-`005` and `007` were applied as the table owner (`postgres`),
which is required to create tables, policies and functions. The owner-safe
`006` test script was then run and passed. Part B remains useful for read-only
schema verification; Part C still requires real authenticated sessions.

---

## Part B — verification queries (also safe as the owner)

Read-only or owner-safe; they confirm the *schema* landed. They prove nothing
about RLS — see Parts C and D.

```sql
-- Must be 0 rows: extra overloads would mean a signature drifted and
-- CREATE OR REPLACE silently created a new function instead of replacing one.
SELECT p.proname, pg_get_function_identity_arguments(p.oid)
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'record_attended_session','update_attended_session',
    'complete_current_lesson','set_student_current_lesson',
    'record_assessment_result','complete_remediation_lesson',
    'compute_next_lesson','next_lessons_for_students',
    'transfer_student_to_centre')
ORDER BY 1, 2;

-- B2. Must be 0 in both. A NULL centre_id on these tables means a historical
--     row has lost its centre context. (students.centre_id may legitimately be
--     NULL -- see Part E.)
SELECT count(*) AS sessions_missing_centre FROM public.attended_sessions WHERE centre_id IS NULL;
SELECT count(*) AS attendance_missing_centre FROM public.attendance        WHERE centre_id IS NULL;

-- B3. Must be 0 rows: every profile that can actually sign in needs a centre.
--     If this returns rows those users will see an empty app. Fix with:
--       INSERT INTO public.staff_centres (staff_id, centre_id)
--       SELECT p.id, (SELECT id FROM public.centres WHERE name='Stanmore Discovery Centre')
--       FROM public.profiles p WHERE p.id IN (...);
SELECT p.id, p.email, p.role FROM public.profiles p
WHERE p.auth_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.staff_centres sc WHERE sc.staff_id = p.id);

-- B4. Must be 0 rows: current centre and open history row must agree.
SELECT s.id, s.full_name, s.centre_id AS current_centre, h.centre_id AS open_history_centre
FROM public.students s
LEFT JOIN public.student_centre_history h
  ON h.student_id = s.id AND h.to_date IS NULL
WHERE s.centre_id IS DISTINCT FROM h.centre_id;

-- B5. Confirm the guard triggers exist. Must return 4 rows.
SELECT tgname, tgrelid::regclass AS on_table
FROM pg_trigger
WHERE tgname IN ('students_guard_centre_change','students_guard_centre_not_null_insert',
                 'attendance_stamp_centre','attended_sessions_stamp_centre')
ORDER BY 1;

-- B6. Exactly one Stanmore centre must exist.
SELECT id, name, active FROM public.centres ORDER BY name;
```

---

## Part C — tests that REQUIRE a real authenticated non-owner user

> **A postgres/owner test run is NOT proof of RLS isolation.** The table owner
> bypasses RLS unless `FORCE ROW LEVEL SECURITY` is set. `006` intentionally
> does not impersonate users: arbitrary `request.*` GUC values and `SET ROLE`
> do not establish a supported Supabase Auth session in the SQL Editor.

These must be done by **actually signing in through the app** as real users with
real `auth_id`s. There is no shortcut from the SQL Editor.

### C1. Sign in as a Stanmore instructor
- [ ] Student list loads and is **not** empty (regression check for the
      `staff_centres` backfill).
- [ ] No student from another centre appears.
- [ ] The register loads and attendance still saves — **this is the real test of
      `stamp_centre_from_student`**, since the frontend never sends a centre.
- [ ] Editing an existing register row (status / time in / out) still saves.
- [ ] Opening another centre's student profile by direct URL shows nothing.

### C2. Sign in as an instructor of a second centre (after adding it)
- [ ] Only that centre's students are visible.
- [ ] Stanmore students are not.
- [ ] No cross-centre student appears in a Stanmore instructor's register.

### C3. Sign in as management
- [ ] Read access still works for their centre.
- [ ] No other centre's students are listed.

### C4. Sign in as admin
- [ ] Full access everywhere (admins short-circuit the helpers).
- [ ] `transfer_student_to_centre()` succeeds and history stays consistent (B4).
- [ ] A direct client-side `UPDATE students SET centre_id = ...` **fails** with
      "cannot be changed directly". Use the RPC even as admin.

### C5. Attempts that must fail
- [ ] Instructor calls `transfer_student_to_centre` → permission error.
- [ ] Instructor tries to update another centre's student → 0 rows affected.
- [ ] Instructor tries to change a historical row's `centre_id` → rejected.

---

## Part D — which tests are meaningful as the owner

| Test | Owner run meaningful? |
|---|---|
| Direct `students.centre_id` UPDATE rejected | **Yes** — trigger runs for the owner |
| `attendance.centre_id` cannot be changed on an existing row | **Yes** — trigger |
| `attendance.centre_id` cannot be spoofed on insert | **Yes** — trigger |
| Transfer RPC closes/opens history correctly | **No** — requires a real admin session |
| Duplicate `staff_centres` insert rejected | **Yes** — PK |
| `can_access_centre` / `can_access_student` per caller | **No** — requires a real session |
| Instructor cannot read another centre's students | **NO** — owner bypasses RLS |
| Instructor cannot update another centre's student | **NO** — owner bypasses RLS |
| Unauthenticated caller cannot read students | **NO** — owner bypasses RLS |

So `006` genuinely validates the trigger-based and constraint-based guarantees.
It does **not** validate the per-caller helper or policy-based guarantees; those
are Part C and require real authenticated sessions.

---

## Part E — direct centre writes: current state

Searched the whole repo on 2026-09-30 for `.update({ centre_id`, `centre_id:`,
and `UPDATE ... students ... centre_id`:

- **Frontend:** no file references `centre_id` at all. `StudentForm.tsx` updates
  students without it and inserts students without it. `pages/Register.tsx`,
  `components/SessionEntryRow.tsx`, `AddToRegister.tsx` and
  `BulkAttendanceModal.tsx` upsert `attendance` directly without it — which is
  why `003` uses a stamping trigger instead of `NOT NULL`.
- **SQL:** the only statements that set `students.centre_id` are the backfill in
  `002` (runs before the guard trigger exists) and `transfer_student_to_centre()`
  in `007`. `006` updates it only inside its rolled-back test transaction.
- `record_attended_session()` (005) sets `attended_sessions.centre_id` on insert
  only, never on update.

### Known limitations to resolve in Phase 2

* **`students.centre_id` is still NULLABLE** because `StudentForm.tsx` inserts
  students without a centre. Until Phase 2 makes the frontend supply one:
  ```sql
  -- 1. find legacy rows
  SELECT id, full_name FROM public.students WHERE centre_id IS NULL;
  -- 2. once the frontend always supplies a valid centre:
  ALTER TABLE public.students ALTER COLUMN centre_id SET NOT NULL;
  ```
  Until then NULL is fail-closed: invisible to instructors and management
  (admin-only), and ordinary staff can neither create a centre-less student nor
  move one to NULL.
* **No centre selector / switcher** in the frontend.
* **No staff assignment UI** — `staff_centres` must be maintained by SQL until
  Phase 2.
* **No `Master` role** — role model unchanged (`admin`, `instructor`,
  `management`).
* `transfer_student_to_centre()` is **admin-only**. If instructors should be
  able to move students, that is a deliberate business decision to make
  explicitly rather than a side effect of this migration.