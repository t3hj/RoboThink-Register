-- Map provided Supabase auth user to a profiles row for RoboThink
-- Run this in your Supabase SQL editor (public schema). This will create or update a profile
-- for tehjpatel@gmail.com and set auth_id to the supplied UUID so RLS functions recognize the user.

-- Replace the UUID below only if you want to change it.
INSERT INTO public.profiles (auth_id, name, email, role)
VALUES ('3c28b072-5b00-42e7-bc18-50c9998eaf21', 'Teh J Patel', 'tehjpatel@gmail.com', 'admin')
ON CONFLICT (email) DO UPDATE
  SET auth_id = EXCLUDED.auth_id,
      name = EXCLUDED.name,
      role = EXCLUDED.role;

-- After running this, sign in to the app with tehjpatel@gmail.com and test instructor/admin flows.
