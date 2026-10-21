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
