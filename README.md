# RoboThink Register

An internal register and lesson-progress tracking system for RoboThink instructors.
Instructors sign in with a magic link, take the daily register (Arrived / Absent /
Time Out / Mark Done), and track each student's progression through the curriculum —
including age-based programme placement and the pass/fail assessment → remediation →
reassessment → intervention workflow.

> **Note on `db/`:** the `.sql` files in this folder describe an *earlier* version of
> the schema and are kept for history only. The live database (Supabase project
> `RoboThink-Register`) has moved well beyond them via migrations applied directly
> to the project (`curriculum_seed`, `persistent_progress`, `staff_curriculum_access`,
> plus everything under `db/migrations_applied_2026-09-13/`, `db/migrations_applied_2026-09-14/`
> and `db/migrations_applied_2026-09-15/`, `db/migrations_applied_2026-09-20/`). Treat the live database, not these files, as
> the source of truth, and run `supabase db pull` (or inspect via the dashboard/SQL
> editor) before assuming the schema matches what's committed here.
> A `student_schedules` table also now exists in the live DB (day/time/week-pattern
> per student) but isn't wired into the frontend yet — the Register still schedules
> off `students.preferred_day`/`preferred_time`, unchanged from before.
> A few pre-existing seed/dummy `profiles` rows (no `auth_id`) remain in the database from
> earlier setup — left untouched per this task's instruction not to force-delete
> potentially-referenced historical records.

## Features

- **Magic-link authentication** via Supabase Auth, mapped to staff profiles with `admin` / `instructor` / `management` roles (see [Roles & permissions](#roles--permissions))
- **Dashboard** — who's expected today, who's in the centre, absences, lessons completed today, recent completions, and everyone currently needing an assessment/remediation/intervention follow-up
- **Daily register** — date navigation, an **"Add to today's register"** action to bring in
  an existing student for a regular/catch-up/special session without touching their normal
  schedule, a compact **feedback reminders** panel, a prominent **"Lessons to be done
  today"** panel (grouped by programme → term → lesson number, so instructors can pull the
  right lesson folders before the session starts), per-student status, automatic
  arrival/time-out times, lesson completion via the real curriculum (with term-boundary
  rollover), a **"Not Finished / Repeat"** action for lessons that don't get finished in a
  session, inline PASS/FAIL and "complete remediation lesson" actions when a student has an
  assessment or remediation pending, inline feedback-sheet reminders per student row,
  catch-up/special attendees clearly labelled alongside the scheduled day
- **Students** — searchable/filterable (day, programme, active) /sortable list with progress bars; admin-only **Add student** with a minimal required form (name, subscription, level, day/time — see [Student creation](#student-creation))
- **Student profile** — a current/next-lesson hero section, manual-override badge when applicable, lesson/assessment/remediation/attendance/feedback history, staff (admin or instructor) **Change current lesson** control (reason required, audited server-side), admin-only **Edit details**
- **Curriculum** — every programme (Junior/Engineer/Advanced/Expert/Master Engineer, Coding), grouped by programme with terms nested underneath, straight from the database, with assessment checkpoints flagged, current selection highlighted
- **Reports** — attendance, lesson-completion, and assessment/remediation statistics over any date range, per student/instructor/level
- **Instructor analytics** (`/analytics`) — today/this-week attendance, a student overview, and a per-student attendance lookup with sensible "missed recently" style flags
- **Management dashboard** (`/management`) — read-only today/week/month attendance stats with week/month-over-week comparisons, student movement (new / declining / long-absent), and Term Time follow-ups
- **Term Time follow-up reminders** — automatically flagged when a Term Time student completes a 12-lesson block; admin records the outcome (contacted/extended/not continuing/snoozed)
- **Staff** (`/staff`, admin-only) — assign roles to existing staff accounts
- **404 handling** and role-aware, authenticated-route protection throughout

## Architecture & tech stack

| Layer    | Tech |
|----------|------|
| Frontend | React 18, TypeScript, Vite, React Router, Tailwind CSS v4 |
| Backend  | Supabase (PostgreSQL, Auth, Row Level Security, SQL functions/RPCs) |
| Testing  | Vitest (unit tests mirroring the live progression/assessment logic and date handling) |

```
frontend/
  src/
    components/   # Toast, shared UI, LevelLessonPicker, ChangeLessonControl,
                  # AssessmentPanel, StudentForm
    lib/          # Supabase client, auth context, date utilities, curriculum
                  # helpers (programme/term parsing), cached curriculum loader
    pages/        # Auth, Dashboard, Register, Students, StudentProfile,
                  # Curriculum, Reports, NotFound
  tests/          # Vitest unit tests
db/               # HISTORICAL schema files — see note above; live DB has diverged
```

## Local setup

```bash
cd frontend
npm install
cp .env.example .env   # fill in your Supabase project values
npm run dev
```

### Environment variables (`frontend/.env`)

```
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-public-key
```

Only the **anon** key is used — it is safe to expose in the browser because all access
is governed by RLS. **Never** put the service-role key in the frontend, and never commit
`.env` (it is gitignored).

## How the curriculum is modelled

- Each **term** of a term-based programme (Junior Engineer, Engineer, Advanced Engineer)
  is its own row in `levels` (e.g. `engineer-term-2`); Expert Engineer, Master Engineer
  and Coding are single, non-termed levels. `frontend/src/lib/curriculum.ts` is the one
  place that parses this convention (`"Engineer - Term 2"` → programme `Engineer`, term `2`).
- `lessons.lesson_kind` is `'normal'` or `'assessment'`; `assessment_points` marks which
  lesson an assessment checkpoint follows.
- A student's progress is entirely separate from the curriculum: `students.current_lesson_id`
  references a real `lessons.id`. Nothing in the frontend hard-codes lesson numbers or names.

## How lesson progression works

- `complete_current_lesson(student_id, date)` (SQL, `SECURITY DEFINER`) records the lesson,
  the authenticated instructor, and calls `next_curriculum_lesson(lesson_id)` to move the
  student on — within the same term if there's a next lesson number, otherwise to lesson 1
  of the next term/level (the Coding track only ever advances within Coding).
- It refuses to advance a student who has an unresolved remediation plan.
- **"Not Finished / Repeat"**: if a student doesn't finish their session, the instructor
  clicks **Not Finished** instead of **Mark Done**. This writes a `lesson_records` row for
  the student's *current* lesson with `status='not_completed'` (reusing the exact same
  table/columns as a completed lesson — no new schema) and does **not** call
  `complete_current_lesson`, so `students.current_lesson_id` is untouched: the current and
  next lesson shown stay exactly the same. Because `lesson_records` has
  `UNIQUE(student_id, level_id, lesson_number)`, repeating the same lesson twice updates the
  same row rather than duplicating it, and actually completing it afterwards upgrades that
  same row to `status='completed'` (see the `complete_current_lesson_upsert_after_repeat`
  migration — it changed `ON CONFLICT DO NOTHING` to `DO UPDATE` so this history stays
  accurate). No new RPC was needed: instructors/admins already have INSERT/UPDATE rights on
  `lesson_records` via RLS.
- `set_student_current_lesson(student_id, lesson_id, reason)` is the **only** way the
  current lesson is changed outside normal completion — admin-only (checked server-side,
  not just hidden in the UI), and every use is written to `progress_overrides` + `audit_log`.

## How assessment / remediation works

- `record_assessment_result(student_id, 'PASS'|'FAIL', date, notes, attended_session_id, remediation_path)`:
  - **PASS** → student continues normally.
  - **FAIL** → the instructor must choose a remediation path (enforced — a FAIL can't be saved
    without one):
    - **Path A: repeat next lesson** — `remediation_plans` goes straight to `ready_for_reassessment`
      with `lessons_required = 0`; the very next attempt is the reassessment, no remediation
      lessons in between.
    - **Path B: 3 remediation lessons** — the original behaviour, unchanged: `status='required'`,
      `lessons_required = 3`.
  - Every assessment event is linked to the specific `attended_sessions` row it happened in
    (`assessments.attended_session_id`) — required for a student with two same-day sessions to
    keep their results distinct.
- `complete_remediation_lesson(...)` (Path B only) logs each remediation lesson — also linked to
  its own session (`remediation_lessons.attended_session_id`) — showing "Remediation 1 of 3",
  "2 of 3", "3 of 3"; after the 3rd, the plan moves to `ready_for_reassessment`.
- Recording a result while `ready_for_reassessment` (the reassessment):
  - **PASS** → normal progression resumes, plan marked `completed`.
  - **FAIL** → the plan moves to `intervention_required` regardless of which path was originally
    chosen — the UI shows a red banner and stops offering further automatic actions; a human
    decides what happens next. The failed assessment and every remediation lesson stay in history.
- Assessment/remediation state is completely separate from "which actual lesson was taught" on a
  session — recording an off-progression actual lesson never touches `pending_assessment_point_id`
  or any `remediation_plans` row.
- Assessment results can't be edited after the fact (no update path exists, deliberately — see
  `pages/StudentProfile.tsx`'s note in the assessment history): reversing a PASS/FAIL safely would
  mean reversing progression too, which the existing architecture has no safe way to do. A genuine
  mistake is corrected via the existing "Change current lesson" tool instead, on `students`
  directly — the historical assessment record itself is preserved either way.
- The Register and Student Profile both surface this via `AssessmentPanel`, driven by the
  `student_progress` view (`current_kind`: `normal` / `assessment` / `remediation` / `complete`)
  and `lib/assessment.ts#remediationStatusLabel` for the exact wording shown ("Remediation 2 of 3",
  "Repeat assessment due", "Ready for reassessment", "Intervention required" — text, not colour
  alone). Deliberately **not** available as a bulk action — assessment/remediation state is too
  student-specific for a mixed group to apply safely in one step.

Unit tests mirroring this logic live in `frontend/tests/progression.test.ts`,
`frontend/tests/repeatLesson.test.ts`, `frontend/tests/feedback.test.ts`,
`frontend/tests/assessmentRemediation.test.ts` and `frontend/tests/curriculum.test.ts`.

## "Lessons to be done today"

A panel at the top of the Register (`components/LessonsToday.tsx`, grouping/sorting logic
in `lib/lessonsToday.ts`, tested in `frontend/tests/lessonsToday.test.ts`) shows, for the
selected date's roster, every student's **current** lesson (never the next lesson, never
inferred from attendance history) grouped by lesson so instructors can pull the right
physical lesson folders before the session starts. Grouping/sort order: programme (by
curriculum `sort_order`) → term (where the programme has terms) → lesson number → student
name. It uses the same roster the rest of the Register uses, so catch-up students are
included automatically, and it updates whenever the selected date changes.

## The attended-session model

A session is an actual, distinct occurrence of a student attending one class on one date —
independent of whether the lesson was completed. This is `public.attended_sessions`
(added alongside the existing `lesson_records`, not instead of it):

- **`lesson_records`** is unchanged: still `UNIQUE(student_id, level_id, lesson_number)`,
  still the ledger progression math reads from, still what the Student page's lesson
  history shows. It answers "what's the current state of this lesson for this student".
- **`attended_sessions`** is new: one row per attended occurrence, unlimited per lesson,
  `UNIQUE(student_id, date, session_number)`. It answers "what actually happened, session
  by session" — two sessions on the same date are two distinct rows (`session_number` 1, 2,
  ...), and a repeat of an already-completed lesson is a new row, never blocked.

Both are written by a single function, `record_attended_session(student_id, actual_lesson_id,
outcome, date)`:
1. Always inserts a new `attended_sessions` row.
2. Always upserts `lesson_records` for the **actual** lesson taught (not necessarily the
   student's current one) — so history stays accurate even for an off-progression repeat.
3. Always creates exactly one `feedback_sheets` row for that session.
4. Only advances `students.current_lesson_id` when `outcome = 'completed'` **and** the
   actual lesson taught is genuinely the student's current progression lesson — recording
   a different actual lesson, or a `not_finished` outcome, never touches progression.

`complete_current_lesson(student_id, date)` — the function the existing Register "Mark
Done" button already calls — is now a thin, backward-compatible wrapper: it looks up the
student's current lesson and calls `record_attended_session(..., 'completed', ...)`. Same
signature, same return value, so the existing frontend flow needed no changes. The
"Not Finished / Repeat" button now calls `record_attended_session` directly with
`outcome = 'not_finished'` (previously a raw client-side `lesson_records` upsert).

### The Register's per-session workflow

Each active student's row has three states — **Not entered** (no attendance row, or one
still at `Not Arrived`), **Attended**, **Absent** — driven by `lib/attendedSessionsUi.ts#attendanceState`.
Only Attended exposes session controls (`components/SessionEntryRow.tsx`): an actual-lesson
picker (Recommended / Nearby / All, always "Lesson N: Title", never a bare number), an
Completed/Not Finished outcome, feedback (once the session exists), and Save. Recording a
different actual lesson than the student's current one, or a Not Finished outcome, never
advances progression — only completing the student's actual current lesson does, exactly as
`record_attended_session` enforces server-side. Choosing an already-completed lesson shows a
non-blocking "this will count as a repeat" note; it never blocks Save.

Reopening a date loads existing `attended_sessions` rows for that date and displays them —
nothing is created just by opening or refreshing the page. Editing an existing session goes
through `update_attended_session` (new in this pass), which corrects that same row rather
than inserting a new one, and — deliberately — never touches progression either way. A
second session on the same date is a genuinely new row (`session_number` 2, 3, ...), shown
separately in the row, never merged with the first.

**Not Finished / build-left-aside**: `attended_sessions` gained `left_aside`,
`left_aside_identifier`, `left_aside_reason` (one of 8 fixed values, `other` requires
`left_aside_note`), enforced by both a DB `CHECK` and a matching client-side validator
(`validateLeftAside`) so mistakes are caught instantly, not after a round trip. When a
student's most recent session (any date) was `not_finished` with a build left aside, the
Register shows a "use build B12 to finish the lesson" reminder — looked up the same way as
feedback reminders (by `student_id`, not date/schedule), so it follows the student to
whatever day they next appear on.

A completeness indicator ("18 / 22 recorded") counts only active students whose attendance
is explicitly Attended or Absent; inactive students never appear in the normal Register or
its counts at all (`.eq('active', true)` on the roster query).

### Bulk actions

Checkboxes per row (plus a "Select all" toggle) drive a selection-count bar
(`components/BulkActionBar.tsx`) with five actions, each with its own review/confirm modal —
nothing applies silently:

- **Mark Attended / Mark Absent** (`BulkAttendanceModal.tsx`) — pure attendance-table writes,
  exactly like the individual Attended/Absent buttons; Absent never touches or removes an
  existing session.
- **Lesson/Outcome** and **Not Finished** (`BulkSessionModal.tsx`, shared) — always creates a
  **new** session per eligible (Attended) student via `record_attended_session`; it never
  edits an existing one, so a student who already has a session that date keeps it untouched
  unless the instructor edits it individually. The lesson picker keeps the same
  Recommended/Nearby/All structure as the individual row, with "Recommended" now meaning the
  most common current lesson among the selected group. Not Finished's build/laptop identifier
  is entered per student in a list — never forced to one shared value — while the reason (and
  Other's note) is shared across the batch.
- **Feedback** (`BulkFeedbackModal.tsx`) — targets each student's specific session for the
  selected date (`lib/bulkActions.ts#resolveFeedbackTarget` — their most recent session that
  date), never their whole feedback history, so a Session 1 / Session 2 same-day student only
  has the intended one touched.

Every modal shows an eligible/skipped breakdown before applying (e.g. "5 will be updated, 2
skipped because they're already Absent") and applies via `Promise.allSettled`, reporting
partial failures honestly rather than claiming full success (`lib/bulkActions.ts#summarizeBulkResults`).
No new database functions were needed — every bulk action reuses the existing
`record_attended_session`/`update_attended_session` RPCs or plain table writes; each
student's update is independent, so a per-item `Promise.allSettled` loop is sufficient rather
than a bespoke atomic bulk RPC.

## Feedback sheets

Feedback is tied to the **session**, not to lesson completion — every attended session
(completed or not finished) gets its own `feedback_sheets` row (`status='not_written'`),
created inside `record_attended_session` itself, keyed uniquely to `attended_session_id`
(a partial unique index, since `lesson_record_id` alone can't be unique here — two sessions
can legitimately point at the same `lesson_records` row, e.g. two same-day sessions that
are both "Lesson 5"). `lesson_record_id` is still populated on new rows for convenient
joins, but is no longer `NOT NULL`/unique — that historical data and column stay intact,
they just aren't the uniqueness anchor any more.

Outstanding feedback (`not_written` or `written_not_taken`) is looked up **by student_id
only** — never by date, schedule, or day-of-week — so the reminder follows the student to
whatever session they next appear at: their normal day, a catch-up, or any other day. It
shows up:
- In the Register's compact **"Feedback reminders"** panel near the top, for every
  attending student with an outstanding sheet.
- Inline in that student's Register row.
- On the Student page, with the full history (grouped by session where available).

Attendance never changes a feedback status — only an explicit instructor action does
(`components/FeedbackControl.tsx`). Logic lives in `lib/feedback.ts` (tested in
`tests/feedback.test.ts`) and the session model itself in `tests/attendedSessions.test.ts`.

## UI/UX polish

- **Focus/contrast/semantics**: a visible `:focus-visible` ring app-wide, one `<h1>` per
  page (`PageHeader`), a skip-to-content link, `role="alert"`/`role="status"` on
  error/loading panels, `aria-label`s on icon-only controls and filters.
- **No raw database errors**: `lib/errors.ts#friendlyMessage` maps Postgres/RLS error text
  to plain language before it reaches `ErrorPanel`; the original is available behind a
  collapsed "Technical details" disclosure rather than being hidden entirely.
- **Students**: added a programme filter (alongside the existing day/active filters) and a
  visual progress bar per student card.
- **Student profile**: a "current lesson" hero section at the top of the page, with a
  visible badge when the current lesson was set by a manual admin override (name, date,
  reason — sourced from `progress_overrides`), plus a feedback-sheet history section.
- **Dashboard**: a quick-actions row to the other main pages, plus a real "feedback
  outstanding" count alongside the existing today/attendance/assessment stats.
- **Curriculum**: the expanded term/level is now visually highlighted (accent border +
  coloured heading) rather than just an open/closed accordion.
- Status colours (attendance, `StatCard` tone) are unchanged and kept separate from the
  brand palette, per the spec.

## RoboThink brand palette

The app now uses RoboThink's office colours — yellow, green, red, blue (`--rt-yellow`,
`--rt-green`, `--rt-red`, `--rt-blue` in `index.css`) — as a **decorative** identity palette:
a thin four-colour stripe at the top of the app shell, a coloured accent bar on each page
header (`PageHeader`'s `accent` prop, one colour per page, assigned arbitrarily for variety),
and the primary action colour (`--rt-primary`, buttons/links/focus rings) is now RoboThink
blue instead of the old teal. These colours are **not** used to mean anything — they don't
indicate status. The actual status colours (attendance Arrived/Absent/Completed, the tone on
`StatCard`, `StatusBadge`) are a separate, pre-existing system and were left as they were.

## Roles & permissions

Three roles, enforced by RLS server-side (never just hidden in the UI):

| | Admin | Instructor | Management |
|---|---|---|---|
| View students/curriculum/register | ✅ | ✅ | ✅ (own dashboard, not the day-to-day pages) |
| Mark attendance, complete/repeat lessons | ✅ | ✅ | ❌ |
| Change a student's current lesson | ✅ | ✅ | ❌ |
| Add a student to today's register | ✅ | ✅ | ❌ |
| Create / edit / archive students | ✅ | ❌ | ❌ |
| Manage curriculum content | ✅ | ❌ | ❌ |
| Assign staff roles | ✅ | ❌ | ❌ |
| Record Term Time follow-up outcomes | ✅ | ❌ | ❌ |
| View analytics | Both | Instructor analytics | Management dashboard |

`handle_new_user()` (the trigger that creates a `profiles` row for every new Supabase Auth
user) still defaults new accounts to `instructor` — nobody is ever auto-admin. An admin can
change anyone's role from `/staff`; `prevent_profile_privilege_escalation()` (pre-existing)
still stops a user from changing their own role. `is_admin()` / `is_instructor()` /
`is_management()` are the RLS building blocks; the frontend's `RoleRoute` in `App.tsx` is a
UX-level safety net on top of that, not the actual enforcement.

## Student creation

Deliberately minimal — RoboThink Register only needs what it takes to run the register:
name, subscription (Elite/Term Time), level, normal day/time, and (on create) a starting
lesson. Date of birth and parent name/contact are **not** part of this workflow at all —
they're not shown on create or edit. Any historical values already in the database are left
untouched; the app just never asks for or displays them going forward. Admin-only, per the
role table above.

## Adding a student to today's register

`components/AddToRegister.tsx` searches active students and writes a single `attendance`
row for today's date with a `session_type` of `regular`, `catch_up`, or `special` — the
student's own `preferred_day`/`preferred_time` are never touched. The existing
`UNIQUE(student_id, date)` constraint means this can never create a duplicate: adding
someone already on the register just updates their existing row. Catch-up/special sessions
still count as real attendance (same `status` values, same progression) — they're just
labelled differently in the roster.

## Term Time follow-ups

`complete_current_lesson` already creates a `term_time_followups` row (`status =
'needs_follow_up'`) whenever a student on the Term Time subscription completes a multiple
of 12 lessons — one row per triggering `lesson_records` id, so it never re-fires for the
same completion and past blocks stay in history. It does **not** touch the student's
subscription. Admin resolves it from the Management dashboard (`contacted` / `extended` /
`not_continuing` / `snoozed` / back to `needs_follow_up`); management can see it but not
change it.

## Development commands

```bash
npm run dev        # Vite dev server
npm run build      # type-check + production build
npm run preview    # serve the production build
npm test           # Vitest unit tests
```

## Deployment

Any static host works (Vercel, Netlify, Cloudflare Pages). Build with `npm run build`
inside `frontend/`, deploy the `dist/` folder, and set `VITE_SUPABASE_URL` and
`VITE_SUPABASE_ANON_KEY` as environment variables in the host's dashboard.
Add the deployed URL to Supabase → Authentication → URL Configuration
(redirect URLs) so magic links work in production.

## Security notes

- All access control is enforced by **Postgres RLS** and server-side checks inside the
  progression/assessment RPCs, not the frontend. The frontend only ever uses the anon key.
- Roles (`admin`, `instructor`) live in `public.profiles`; the RLS helper functions
  `is_admin()` / `is_instructor()` resolve the caller via `auth.uid()`.
- Instructors can read students/curriculum and write attendance/lesson/assessment records;
  only admins create/edit/delete students, change a student's current lesson, and manage
  curriculum content.
- Users cannot change their own role.
- `audit_log` and `curriculum_progression_log` are staff-readable and effectively
  append-only from the client (writes happen inside `SECURITY DEFINER` functions).
- `student_schedules` also had RLS enabled with zero policies (silently blocking
  everyone, staff included) — added a staff-read policy for consistency, even though
  the frontend doesn't use this table yet.
- Three views (`student_assessment_status`, `students_requiring_assessment_action`,
  `total_lessons_per_level`) were `SECURITY DEFINER`, which bypassed RLS and — combined
  with Supabase's default `anon` grants — let unauthenticated requests read student and
  assessment data via the REST API. They've been switched to `security_invoker = true` so
  they now respect the same RLS as everything else.
- **Still open:** Supabase Auth's "leaked password protection" (HaveIBeenPwned check) is
  disabled for this project. This is an Auth setting, not a SQL migration — enable it in
  Supabase Dashboard → Authentication → Policies.

## Known limitations / follow-ups

- Curriculum lesson titles are placeholders (`Lesson 1`, `Lesson 2`, …) for CMAP-backed
  programmes, by design — they're meant to be replaced later. There is no in-app curriculum
  *editing* UI yet (only viewing, which is available to all staff); editing is currently a
  database-level task for admins.
- `assessment_points` were seeded generically (one checkpoint after the final lesson of
  every level) so the assessment workflow has something to trigger against end-to-end.
  Replace these with the real assessment points for your curriculum when known.
- Magic-link sign-in requires email delivery to be configured in your Supabase project.
- Reports are computed client-side over the selected date range; for very large datasets
  these aggregations would be better served by SQL views/RPCs.
- "Student movement" on the Management dashboard covers new / declining / long-absent
  students; it does not attempt to detect "returning" students (someone who was flagged
  long-absent and has since come back) — a reasonable follow-up if needed.
- Instructor/management "Trends" are shown as this-week-vs-last-week and
  this-month-vs-last-month numeric comparisons rather than charts, to avoid adding a
  charting dependency that wasn't already in the project.
- The three seed/dummy `profiles` rows (no `auth_id`) show up in `/staff`'s list; they're
  harmless (can't sign in) but could be tidied up later if desired — left alone here since
  they may be referenced by historical `lesson_records`.
