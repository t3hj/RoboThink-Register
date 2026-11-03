-- Run against the live schema; all fixture edits are rolled back.
begin;
create temporary table staff_auth_fixtures as
select
 (select auth_id from public.profiles where role = 'admin' and auth_id is not null limit 1) as admin_id,
 p.auth_id as staff_id, p.id as profile_id, p.email, p.name, p.role
from public.profiles p join auth.users u on u.id = p.auth_id
where p.role = 'instructor' and u.email_confirmed_at is not null
 and p.email = u.email
 and (select count(*) from public.profiles q where lower(q.email) = lower(p.email)) = 1
limit 1;
do $$ begin
 if not exists(select 1 from staff_auth_fixtures where admin_id is not null) then
   raise exception 'Approval test needs a linked admin and verified instructor';
 end if;
end $$;
grant select on staff_auth_fixtures to authenticated;
set local role authenticated;
select set_config('request.jwt.claim.sub', (select staff_id::text from staff_auth_fixtures), true);
do $$ begin
 begin
   perform public.approve_staff('nobody@example.invalid', 'Test', 'admin');
   raise exception 'FAIL: instructor approved staff';
 exception when insufficient_privilege then null;
 end;
 begin
   update public.profiles set role = 'admin' where auth_id = auth.uid();
   raise exception 'FAIL: instructor changed own role';
 exception when raise_exception then
   if sqlerrm <> 'Users cannot change their own role' then raise; end if;
 end;
end $$;
-- A signed-in account without a profile cannot create one through the Data API.
select set_config('request.jwt.claim.sub', gen_random_uuid()::text, true);
do $$ begin
 begin
   insert into public.profiles(auth_id, name, role) values(auth.uid(), 'Unapproved', 'admin');
   raise exception 'FAIL: unapproved account created a profile';
 exception when insufficient_privilege then null;
 end;
end $$;
reset role;
-- Temporarily unlink an existing instructor, then test admin reapproval.
-- The original profile ID and all centre assignments must be preserved.
select set_config('request.jwt.claim.sub', '', true);
update public.profiles set auth_id = null where id = (select profile_id from staff_auth_fixtures);
set local role authenticated;
select set_config('request.jwt.claim.sub', (select admin_id::text from staff_auth_fixtures), true);
do $$ declare approved uuid; begin
 select public.approve_staff(email, name, role) into approved from staff_auth_fixtures;
 if approved is distinct from (select profile_id from staff_auth_fixtures) then
   raise exception 'FAIL: approval did not preserve the profile ID';
 end if;
 if not exists(select 1 from public.profiles p join staff_auth_fixtures f on p.id = f.profile_id
   where p.auth_id = f.staff_id and p.role = f.role) then
   raise exception 'FAIL: staff identity or role changed';
 end if;
 begin
   perform public.approve_staff(email, name, role) from staff_auth_fixtures;
   raise exception 'FAIL: duplicate approval accepted';
 exception when raise_exception then
   if sqlerrm not like 'This account already has staff access%' then raise; end if;
 end;
end $$;
reset role;
rollback;
select 'Passed: instructor approval denied, self-promotion denied, self-provisioning denied, admin approval preserved identity, duplicate approval denied; fixtures rolled back' as verification;
