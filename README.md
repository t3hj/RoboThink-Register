RoboThink Register

This repository contains the RoboThink internal student register and lesson-tracking project artifacts.

Included:
- db/robothink_schema.sql  — Postgres schema for Supabase (compute_next_lesson function included)
- db/robothink_seed_fixed.sql — Seed data with fixed UUIDs for testing
- db/robothink_rls.sql — Row Level Security policies and helper functions

Getting started (local):
1. Create a Supabase project and run the SQL files in the SQL editor in the following order:
   - db/robothink_schema.sql
   - db/robothink_seed_fixed.sql
   - db/robothink_rls.sql
2. In Supabase Auth, create instructor/admin accounts and copy their auth.user IDs.
3. Map auth IDs to profiles in the db using:
   UPDATE public.profiles SET auth_id = '<AUTH_USER_ID>' WHERE email = 'dan@example.com';

Frontend (not included in this initial import):
- The frontend scaffold (Vite + React + TypeScript + Tailwind) was developed locally. If you want that pushed here as well, let me know and it will be added to the repo.

Notes:
- Do NOT expose the Supabase service_role key in client apps. Use it only server-side for administrative scripts.
- After running RLS, test instructor workflows by signing in with mapped auth users.

Contact:
- Repo prepared by Copilot-assisted automation for RoboThink project.