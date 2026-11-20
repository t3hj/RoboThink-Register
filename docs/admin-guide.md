# Admin guide

## Adding staff

1. Make sure the person has a sign-in account: ask them to request a magic link
   once, or create the user in Supabase Auth.
2. An admin links that account to a staff profile in Supabase (see the
   development example in `db/map_auth_tehjpatel.sql`; use private placeholders,
   never commit real emails or IDs).
3. In **Staff**, set their role and assign them to venues.

| Role | Access |
| --- | --- |
| Instructor | Register, curriculum, progression, feedback, reports; can *request* students |
| Management | Management dashboard; can add and edit students and approve requests at their centres |
| Admin | Everything above plus staff, corrections, centre transfers and all centres |

## Centres

In **Staff**, **Add venue** creates a centre for the active brand and the
toggle on each centre switches it on or off. Use **Assign** to give an instructor
access to a venue; **Remove** takes it away.

## Database updates

Migrations live in `db/`. Folders named `migrations_applied_*` have already been
run on the live project; `migrations_pending_*` have not. The live Supabase schema
is the source of truth. Review each file before applying it in the Supabase SQL
editor.

Migrations that add several sessions per student, manager access to students
and student requests are in `db/migrations_pending_2026-10-20/` and
`db/migrations_pending_2026-10-18/`. Check the folder names against what has
already been run before applying anything.

`db/migrations_pending_2026-10-20/002_set_starting_lesson.sql` lets instructors set
the starting lesson for a student who has none (used after a Pebble import).

After applying any migration, check Row Level Security still blocks anonymous
access and that instructors can only see their own centres.

## Data hygiene

- Never commit `.env`, service-role keys, real student, parent or staff data, or
  curriculum documents. See the privacy checklist in the main README.
- Review the Dashboard's "Registers still to fill in" weekly with the team.
  Percentages are only as accurate as the register.
- Mark students who leave **Inactive** rather than deleting them.

## Management attendance and follow-ups

The Management dashboard follows the selected brand and working centre. Use
**Today**, **This week** (Monday–Sunday), **Last week**, **This month**, or a custom
date range. Click a total or use the attendance tabs to see student names, dates,
centres and separately recorded sessions. Every name opens the student profile.

- **Students attended** counts people; **Sessions attended** counts visits. Two
  completed lessons do not create two attendance sessions. Use **Record another
  session** only for a separate attended session. An attended historical date
  without session details counts once.
- **Missed classes** keeps the original absence visible. **Outstanding absences**
  excludes absences already made up. Catch-ups show booked, attended and missed
  separately, including the absence they covered. A missed catch-up does not
  create another owed regular class. Future bookings cannot make up an absence.
- **Unmarked registers** lists past expected classes with missing marks, where
  the centre's register ran. It does not label unmarked or future classes absent;
  closures, join dates and fortnightly schedules are respected.
- **Term-time follow-ups** become due after every **12 attended sessions** in the
  available register history, with an early warning at 10. Unfinished, assessment,
  project and attended catch-up sessions count; absences and unmarked sessions do
  not. Two explicitly recorded sessions on the same day count twice.
- Managers and admins can save a follow-up's status, notes and next contact date.
  **Follow up later** requires a date; a past next contact date is marked overdue.
  Renewed and not-continuing decisions are hidden unless **Include resolved** is
  selected. Decisions belong to their 12-session block, so a renewal at session
  12 does not suppress the next follow-up at session 24.
- Older lesson-based follow-ups are retained separately for reference. New
  reminders are calculated from attendance, without relying on lesson numbers.

**Needs attention** and term-time reminders show the current position, regardless
of the selected attendance period. Attendance percentages credit made-up regular
absences as fulfilled and never count unused extras twice. Each student's
catch-ups can cover only that same student's absences. Trends remain available
under **Attendance trends** below the operational lists.

Deployment includes the `management_session_followups` database migration. It
adds session-block decisions and next-contact dates, gives management scoped
insert/update access and removes the old lesson-number follow-up creation from
the internal progression helper. Existing follow-up records are preserved.
