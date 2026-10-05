# RoboThink Register

RoboThink Register is an internal web application for managing attendance,
lesson progression, assessments and feedback for RoboThink teaching teams. It
replaces a collection of manual register and progress-tracking tasks with one
authenticated operational workflow.

This public repository contains application code, schema patterns and synthetic
development data only. It must not contain RoboThink's curriculum content or
real student, parent or staff records.

## Overview

The system helps instructors answer three operational questions:

1. Who is expected and what is their attendance status?
2. What progression activity is due or has been completed?
3. What follow-up is needed after a session, assessment or missed lesson?

It is designed for authorised RoboThink staff. It is not a public student
portal.

## Features

- Magic-link sign-in through Supabase Auth.
- Role-aware dashboards for instructors, management and administrators.
- Daily register with date navigation, catch-up/special attendees and bulk actions.
- Attendance, arrival/time-out and attended-session recording.
- Lesson completion, not-finished/repeat handling and progression tracking.
- Assessment, remediation and reassessment workflows.
- Session-linked feedback-sheet reminders.
- Student search, profiles, history and progress views.
- Attendance, completion and assessment reporting.
- Management summaries and staff-role administration.
- Centre selection and centre-scoped access where the live database supports it.

## How it works

Staff sign in, open the register for the relevant date, and update each
student's attendance. For an attended session, the instructor selects the
lesson actually taught, chooses the outcome, and records the session feedback.
Completing the student's current progression lesson advances their progression;
recording another lesson or marking a session not finished does not.

Assessment failures follow the configured repeat or remediation path. A
not-finished session remains visible for later catch-up or repeat work. Historical
dates can be opened to correct or backfill attendance, subject to the user's
permissions.

## Staff guide

### Sign in

Use the staff sign-in page and request a magic link. An account must be linked
to an authorised staff profile in Supabase. If the account has no profile or
the wrong role, contact an administrator.

### Daily register

1. Choose the session date.
2. Review the scheduled students and add a student for a catch-up or special
   session when needed.
3. Mark each student attended or absent.
4. For an attended student, record arrival/time-out and the lesson actually
   completed or attempted.
5. Record the feedback sheet when it has been given.
6. Use the completeness indicator and outstanding reminders before closing the
   register.

Use the lesson picker rather than relying on a lesson number from memory. It
shows the authorised curriculum data available to the signed-in staff member.

### Not finished, repeats and catch-up

Use **Not Finished** when the student did not complete the session's work.
This keeps the current progression lesson in place. A later session can record
the same lesson as a repeat or catch-up. If a build or other item is left
aside, record the identifier and reason so the next session has a reminder.

Bulk actions always show an eligible/skipped review before applying. They create
or update only the records described by the selected action; review the result
for partial failures.

### Feedback and progression

Each attended session has its own feedback-sheet record. Outstanding feedback
follows the student rather than a particular weekday, so it can be completed
at a later catch-up session.

Progression is based on the database's current lesson and completion history.
Administrators can use the audited change-current-lesson workflow when a
verified transfer or correction is needed.

### Roles

| Role | Typical access |
| --- | --- |
| Instructor | Day-to-day register, students, curriculum, progression, feedback and reports |
| Management | Read-only operational and management views for authorised centre data |
| Admin | Instructor capabilities plus staff management, corrections, overrides and wider centre access |

The frontend hides routes by role, but database RLS and server-side functions
are the security boundary.

## Curriculum and progression

Programme/level names and progression structure are stored in Supabase. Lesson
titles, descriptions, objectives, materials and notes are private operational
data and are intentionally not reproduced in this repository or README.

The frontend reads curriculum records only for authenticated, authorised staff.
Apply the migration in
`db/migrations_applied_2026-10-06/001_public_curriculum_access_hardening.sql`
to make the table grants and RLS requirement explicit in a Supabase project.

## Technical architecture

- **Frontend:** React 18, TypeScript, Vite, React Router and Tailwind CSS.
- **Backend:** Supabase PostgreSQL, Supabase Auth, RLS policies and PostgreSQL
  functions/RPCs.
- **Client access:** the browser uses only the Supabase anonymous public key;
  authorisation must be enforced by RLS and database functions.
- **Tests:** Vitest unit tests cover progression, attendance, feedback,
  assessment paths and bulk-action logic.

## Repository structure

```text
frontend/src/                 React application, pages, components and helpers
frontend/tests/               Unit tests
frontend/.env.example         Local configuration template
db/                           Schema, migrations, RLS and synthetic seed examples
frontend/public/              Small static UI assets
```

The migration folders describe database changes applied over time. The live
Supabase schema is the source of truth; compare it with the migration history
before applying changes to a production project.

## Local development

```bash
cd frontend
npm install
copy .env.example .env
npm run dev
```

Set these variables in `frontend/.env`:

```text
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-public-key
```

Never put a Supabase service-role key in the frontend or commit `.env`.
The repository's seed file is synthetic and is intended only for a disposable
development database.

Useful commands:

```bash
npm run build
npm test
```

## Database and security

Important concepts include staff profiles and roles, centres and staff-centre
assignments, students, levels and lessons, attendance, attended sessions,
lesson records, assessments, remediation plans, feedback sheets, reports and
audit history.

RLS should allow only authenticated authorised staff to read internal tables.
Curriculum tables require explicit staff policies; student and staff records
must not be available to anonymous users. Security-definer functions must
validate the caller's role and centre scope and use a fixed search path where
appropriate.

The public repository cannot prove the configuration of a live Supabase
project. Before deployment, verify RLS, table grants, function execute grants,
view security-invoker settings and authenticated cross-centre tests in the
Supabase project itself.

## Deployment

The frontend can be built with `npm run build` and deployed to a static
hosting provider configured with the Supabase URL and anonymous key. Database
migrations must be applied in dependency order in the target Supabase project.
Do not copy production data into this repository or into a shared development
seed.

## Project background

This project was built to improve the workflow around attendance, lesson
progression, session preparation, assessment follow-up and feedback recording.
It provides a single operational view while keeping curriculum and personal
data inside the authorised application environment.

## Privacy checklist before pushing

- Do not add `cmap.txt`, `C-map.pdf`, screenshots of lesson content or exports.
- Do not add real student, parent or staff records to SQL seeds or tests.
- Do not commit `.env`, service-role keys, passwords or auth mapping details.
- Use synthetic placeholders when demonstrating database structure.
