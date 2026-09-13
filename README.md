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
> `fix_security_definer_views_and_rls_gaps`, `seed_assessment_points_at_end_of_each_level`,
> `harden_function_search_paths`). Treat the live database, not these files, as the
> source of truth, and run `supabase db pull` (or inspect via the dashboard/SQL editor)
> before assuming the schema matches what's committed here.

## Features

- **Magic-link authentication** via Supabase Auth, mapped to staff profiles with `admin` / `instructor` roles
- **Dashboard** — who's expected today, who's in the centre, absences, lessons completed today, recent completions, and everyone currently needing an assessment/remediation/intervention follow-up
- **Daily register** — date navigation, per-student status, automatic arrival/time-out times, lesson completion via the real curriculum (with term-boundary rollover), inline PASS/FAIL and "complete remediation lesson" actions when a student has an assessment or remediation pending, catch-up attendees shown alongside the scheduled day
- **Students** — searchable/filterable/sortable list with programme/term, preferred day/time, subscription and progress; admin-only **Add student** with an age-based default programme (Engineer at 7+, Junior Engineer under 7 — corrected before saving if needed)
- **Student profile** — current lesson and next lesson shown explicitly (not just a lesson number), lesson/assessment/remediation/attendance history, admin-only **Change current lesson** control (reason required, audited server-side) and **Edit details**
- **Curriculum** — every programme (Junior/Engineer/Advanced/Expert/Master Engineer, Coding), grouped by programme with terms nested underneath, straight from the database, with assessment checkpoints flagged
- **Reports** — attendance, lesson-completion, and assessment/remediation statistics over any date range, per student/instructor/level
- **404 handling** and authenticated-route protection throughout

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
- `set_student_current_lesson(student_id, lesson_id, reason)` is the **only** way the
  current lesson is changed outside normal completion — admin-only (checked server-side,
  not just hidden in the UI), and every use is written to `progress_overrides` + `audit_log`.

## How assessment / remediation works

- `record_assessment_result(student_id, 'PASS'|'FAIL', date, notes)`:
  - **PASS** → student continues normally.
  - **FAIL** → a `remediation_plans` row is created requiring 3 remediation lessons.
- `complete_remediation_lesson(...)` logs each remediation lesson; after the 3rd, the plan
  moves to `ready_for_reassessment`.
- Recording a result while `ready_for_reassessment`:
  - **PASS** → normal progression resumes.
  - **FAIL** → the plan moves to `intervention_required` — the UI shows a red banner and
    stops offering further automatic actions; a human decides what happens next.
- The Register and Student Profile both surface this via `AssessmentPanel`, driven by the
  `student_progress` view (`current_kind`: `normal` / `assessment` / `remediation` / `complete`).

Unit tests mirroring this logic live in `frontend/tests/progression.test.ts` and
`frontend/tests/curriculum.test.ts`.

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
