# RoboThink Register

An internal register and lesson-progress tracking system for RoboThink instructors.
Instructors sign in with a magic link, take the daily register (Arrived / Absent /
Time Out / Mark Done), and track each student's progression through the curriculum.

## Features

- **Magic-link authentication** via Supabase Auth, mapped to staff profiles with `admin` / `instructor` roles
- **Dashboard** — who's expected today, who's in the centre, absences, lessons completed, recent completions
- **Daily register** — date navigation, per-student status, automatic arrival/time-out times, one-click lesson completion with confirmation, catch-up attendees shown alongside the scheduled day
- **Students** — searchable/filterable/sortable list with level, preferred day/time, subscription and progress
- **Student profile** — lesson history, attendance history and percentage, subscription and parent details, next-lesson override (admin only)
- **Curriculum** — levels and lessons straight from the database
- **Reports** — attendance and lesson-completion statistics over any date range, per student/instructor/level, plus students whose attendance may need a check-in
- **404 handling** and authenticated-route protection throughout

## Architecture & tech stack

| Layer    | Tech |
|----------|------|
| Frontend | React 18, TypeScript, Vite, React Router, Tailwind CSS v4 |
| Backend  | Supabase (PostgreSQL, Auth, Row Level Security) |
| Testing  | Vitest (unit tests for date handling and lesson-progression logic) |

```
frontend/
  src/
    components/   # Toast notifications + shared UI (badges, stat cards, dialogs)
    lib/          # Supabase client, auth context, UK-local date utilities
    pages/        # Auth, Dashboard, Register, Students, StudentProfile,
                  # Curriculum, Reports, NotFound
  tests/          # Vitest unit tests
db/
  robothink_schema.sql                   # tables, views, compute_next_lesson
  robothink_seed_fixed.sql               # sample data
  robothink_rls.sql                      # RLS policies & role helper functions
  map_auth_tehjpatel.sql                 # example auth-user → profile mapping
  migration_001_progression_and_rls.sql  # hardened progression + RLS + validation
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
## Supabase setup

1. Create a Supabase project.
2. In the SQL editor, run the files in `db/` **in this order**:
   1. `robothink_schema.sql` — tables, views, `compute_next_lesson`
   2. `robothink_seed_fixed.sql` — sample students/levels/records (optional)
   3. `robothink_rls.sql` — enables RLS and creates the policies
   4. `migration_001_progression_and_rls.sql` — **required**: hardened next-lesson
      calculation, RLS fixes (no self-promotion to admin, admin deletes) and
      data-validation triggers
3. Authentication → enable **Email magic link**.
4. Create staff users in Authentication → Users.
5. Map each auth user to a staff profile row (see `db/map_auth_tehjpatel.sql`):

```sql
UPDATE public.profiles
SET auth_id = '<auth-user-uuid>'
WHERE email = 'instructor@example.com';
```

## How lesson progression works

`compute_next_lesson(student_id)` (see `db/`):

1. The next lesson is `MAX(completed lesson_number) + 1` for the student's current level.
2. A manual `override_next_lesson` (set by an admin) wins if it is higher than the
   completed max — used for transfers from other centres.
3. Missed lessons are simply not completed, so they remain the next lesson.
4. If the current level is unset, the most recent level with completions is used;
   a student with no level shows `—` rather than erroring.
5. `UNIQUE(student_id, level_id, lesson_number)` on `lesson_records` makes lesson
   completion idempotent — double-clicks can't create duplicate completions.

Unit tests mirroring this rule live in `frontend/tests/progression.test.ts`.

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

- All access control is enforced by **Postgres RLS**, not the frontend. The frontend
  only ever uses the anon key; a signed-in user can do exactly what the policies permit.
- Roles (`admin`, `instructor`) live in `public.profiles`; the RLS helper functions
  `is_admin()` / `is_instructor()` resolve the caller via `auth.uid()`.
- Instructors can read students and write attendance/lesson records; only admins
  manage students, progress overrides and deletions.
- Users cannot change their own role (enforced in migration 001).
- `audit_log` is admin-only and append-only.
- Data-validation triggers reject future dates and out-of-order attendance times.

## Known limitations

- Adding/editing students is a database-level task for now (admin via the Supabase
  dashboard); the UI is read-only for student records.
- Magic-link sign-in requires email delivery to be configured in your Supabase project.
- Reports are computed client-side over the selected date range; for very large
  datasets these aggregations would be better served by SQL views/RPCs.
