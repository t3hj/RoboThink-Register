# Agent / dev environment notes

## Running the app in the Base44 sandbox

```bash
docker compose -f docker-compose.base44.yml up -d --build
```

- The single `web` service runs the repo's Vite dev server from the bind-mounted
  source (`node:22-slim`), so frontend edits hot-reload — no image rebuild needed.
- Host port **3000** maps to the Vite dev port 5173. The dev server binds
  `0.0.0.0` via the CLI flags in the compose command.
- `npm install` runs on container start (lockfile-pinned via `package-lock.json`).

## Supabase credentials

This app is a React/Vite frontend whose entire backend is **Supabase** (hosted
Postgres + Auth + RLS). It needs two client-side values:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY` (anon/public key only — never a service-role key)

They are delivered by the Base44 platform through `/run/base44/app.env`; the
compose lists `./.env.base44-defaults` first (placeholders) and the platform
file last, so real values win. Without them the app still mounts and shows a
"Supabase is not configured" banner on the sign-in page.

`db/` contains the schema/RLS/migration SQL and a synthetic seed. The repo
README states the live Supabase schema is the source of truth; applying these
migrations is a manual step in the Supabase project, not part of boot.

## Verifying it works

- `curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/` → `200`.
- The rendered page is the sign-in screen ("Sign in to RoboThink") with no
  "Supabase is not configured" banner when credentials are present.
- Sign-in is Supabase magic-link email auth: an account must be linked to a
  staff profile row to reach the operational pages.

## Quirk: the register's "next lesson" is derived from history

`students.current_lesson_id` is a denormalised pointer that only the register
RPCs advance, so backfilled/imported session history leaves it stale. The
Register therefore derives the lesson it shows from the student's recorded
COMPLETED lesson history (`frontend/src/lib/expectedLesson.ts`, unit-tested in
`frontend/tests/expectedLesson.test.ts`), keeping the stored pointer only for
non-normal progression states (assessment/remediation/complete), an unchecked
`override_next_lesson`, and students with no history. `frontend/tests/` is run
with `npx vitest run` (169 tests); typecheck with `npx tsc --noEmit`.
