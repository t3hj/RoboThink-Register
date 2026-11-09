# Register audit repairs — 9 November 2026

Prepared against main commit `8fb5cf4603d1417ea2562319c2470401678f02be`.
No hosted changes have been made as part of this repair preparation.

## Changes

- Pebble accepts attached or spaced AM/PM times, including noon and midnight.
  Malformed time suffixes are rejected rather than silently read as a different time.
- Coding resumes an earlier sequence after two consecutive completed session
  attempts in curriculum order. For example, 20 → 5 → 6 recommends 7.
  One catch-up, a repeated lesson, skipped lessons and unfinished attempts do
  not reset it. Legacy lesson records alone do not count as two sessions.
  Robotics progression, explicit numeric overrides, assessments and remediation
  retain their existing rules.
- A private invoker trigger keeps the stored coding pointer aligned when a
  session is linked to its saved lesson record. It checks staff identity,
  student access, the latest two coding sessions, and manual checkpoints.
  It changes no existing history and performs no retrospective bulk update.
- Register reads, reports and Pebble duplicate matching load every page with
  a deterministic order. Partial page failures return an error and discard
  incomplete results. The import's 2,000-student lookup cap is removed.
- The historical staff approval migration skips the permission revoke when
  `handle_new_user()` is absent. The legacy automatic approval trigger stays
  disabled; its function is never recreated.

## Local validation

Verified: 370 frontend tests, 16 database scenarios, TypeScript and production build pass.

Run `npm ci` and `npm run test:db` from the repository root. The database
checks use PGlite with synthetic schema and identities; no hosted credentials
or student records are required. They check the coding trigger and repeatable
staff approval migration with the legacy function present and absent.

From `frontend`, run `npm ci`, `npm test` and `npm run build`. Regression cases
cover coding sequence recovery, protected states, compact times, more than
2,000 paginated records, smaller server page caps and later-page failures.

## Release steps requiring approval

1. Push the reviewed branch / PR. GitHub integrations can automatically create
   previews or run checks on push, so this is an external action.
2. Apply the new `resume_coding_sequence` migration to the intended live
   RoboThink project after checking its current schema. The existing staff
   approval migration is already applied there; do not replay it or rewrite
   live migration history just to match the repository timestamp.
3. Rerun the failed Supabase preview check and inspect the complete migration
   chain. The guarded revoke fixes its confirmed first error. A clean-schema
   bootstrap is not proven: the historical schema files mostly live under
   `db/`, outside the CLI migration directory. Any additional missing baseline
   prerequisites must be resolved before calling the preview healthy.
4. Verify the deployed frontend against the intended database, including a
   synthetic Pebble import and an authorised coding sequence. Retain no test
   attendance or personal data.

Existing coding recommendations are reconstructed from history in the Register.
The new database trigger synchronises the stored pointer on subsequent eligible
session writes; it deliberately does not bulk-rewrite existing student pointers.
