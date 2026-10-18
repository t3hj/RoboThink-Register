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
| Instructor | Register, students, curriculum, progression, feedback and reports |
| Management | Read-only management dashboard |
| Admin | Everything above plus staff, corrections and wider centre access |

## Centres

In **Staff**, **Add venue** creates a centre for the active brand and the
toggle on each centre switches it on or off. Use **Assign** to give an instructor
access to a venue; **Remove** takes it away.

## Database updates

Migrations live in `db/`. Folders named `migrations_applied_*` have already been
run on the live project; `migrations_pending_*` have not. The live Supabase schema
is the source of truth. Review each file before applying it in the Supabase SQL
editor.

**Fortnightly attendance:** apply
`db/migrations_pending_2026-10-18/001_fortnightly_attendance.sql`. Until then the
app works as before and the *Every other week* option can't be saved. After
applying it, set each fortnightly student's pattern by editing them.

After applying any migration, check Row Level Security still blocks anonymous
access and that instructors can only see their own centres.

## Data hygiene

- Never commit `.env`, service-role keys, real student, parent or staff data, or
  curriculum documents. See the privacy checklist in the main README.
- Review the Dashboard's "Registers still to fill in" weekly with the team.
  Percentages are only as accurate as the register.
- Mark students who leave **Inactive** rather than deleting them.
