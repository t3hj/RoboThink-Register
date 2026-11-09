-- Authentication never grants a staff role. Existing profiles and assignments stay intact.
drop trigger if exists on_auth_user_created on auth.users;
-- Some preview databases have no legacy auto-profile function.
-- Keep the trigger disabled in either case; never recreate automatic approval.
do $$
begin
  if to_regprocedure('public.handle_new_user()') is not null then
    revoke execute on function public.handle_new_user() from public, anon, authenticated;
  end if;
end;
$$;
drop policy if exists profiles_insert_own on public.profiles;

-- Only this private helper needs privileged access to verified Auth identities.
create schema if not exists private;
grant usage on schema private to authenticated;
create or replace function private.approve_staff(in_email text, in_name text, in_role text)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  target_auth_id uuid;
  target_profile_id uuid;
  target_email text;
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Only administrators can approve staff access' using errcode = '42501';
  end if;
  if in_role is null or in_role not in ('admin', 'instructor', 'management')
    or nullif(pg_catalog.btrim(in_name), '') is null then
    raise exception 'Enter a name and a valid staff role';
  end if;
  select u.id, u.email into target_auth_id, target_email
  from auth.users u
  where pg_catalog.lower(u.email) = pg_catalog.lower(pg_catalog.btrim(in_email))
    and u.email_confirmed_at is not null
  for update;
  if target_auth_id is null then
    raise exception 'Ask this staff member to sign in and verify their email first, then approve them here';
  end if;
  if exists (select 1 from public.profiles where auth_id = target_auth_id) then
    raise exception 'This account already has staff access. Use the staff roles list to make changes';
  end if;
  -- Preserve an existing historical profile and its assignments when unambiguous.
  if (select count(*) from public.profiles where pg_catalog.lower(email) = pg_catalog.lower(target_email)) > 1 then
    raise exception 'Multiple staff profiles use this email. Ask your administrator to resolve them first';
  end if;
  select id into target_profile_id from public.profiles
    where pg_catalog.lower(email) = pg_catalog.lower(target_email) and auth_id is null for update;
  if target_profile_id is not null then
    update public.profiles set auth_id = target_auth_id, name = pg_catalog.btrim(in_name), role = in_role
      where id = target_profile_id;
  elsif exists (select 1 from public.profiles where pg_catalog.lower(email) = pg_catalog.lower(target_email)) then
    raise exception 'This email is already linked to another staff identity';
  else
    insert into public.profiles(auth_id, name, email, role)
      values(target_auth_id, pg_catalog.btrim(in_name), target_email, in_role) returning id into target_profile_id;
  end if;
  return target_profile_id;
end;
$$;
revoke all on function private.approve_staff(text, text, text) from public, anon;
grant execute on function private.approve_staff(text, text, text) to authenticated;

-- PostgREST exposes the invoker wrapper, never the privileged implementation.
create or replace function public.approve_staff(in_email text, in_name text, in_role text)
returns uuid language sql security invoker set search_path = ''
as $$ select private.approve_staff(in_email, in_name, in_role); $$;
revoke all on function public.approve_staff(text, text, text) from public, anon;
grant execute on function public.approve_staff(text, text, text) to authenticated;
