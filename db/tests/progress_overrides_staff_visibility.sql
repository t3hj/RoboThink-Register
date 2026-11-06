-- Run against a populated database as postgres. Uses existing staff claims; no permanent writes.
-- This regression failed for five instructor accounts before the read policy was added.
begin;
create temp table override_visibility(role text, expected bigint, visible bigint);
do $$
declare staff record; expected_count bigint; visible_count bigint;
begin
for staff in select auth_id,role from public.profiles where auth_id is not null loop
perform set_config('request.jwt.claim.sub',staff.auth_id::text,true);
perform set_config('request.jwt.claims',json_build_object('sub',staff.auth_id,'role','authenticated')::text,true);
select count(*) into expected_count from public.progress_overrides where public.can_access_student(student_id);
set local role authenticated;
select count(*) into visible_count from public.progress_overrides;
reset role;
if expected_count <> visible_count then
  raise exception 'Progression checkpoints hidden for staff role %', staff.role;
end if;
insert into override_visibility values(staff.role,expected_count,visible_count);
end loop;
end $$;
select role,count(*) as accounts,sum(expected) as expected_records,sum(visible) as visible_records,count(*) filter(where expected<>visible) as mismatching_accounts from override_visibility group by role;
rollback;
