import { PGlite } from '@electric-sql/pglite'
import fs from 'node:fs'
import assert from 'node:assert/strict'

const db = new PGlite()
const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`
await db.exec(`
 create role authenticated; create role anon; create schema auth;
 create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 create table students(id uuid primary key, centre_id uuid, brand text, current_lesson_id uuid, current_level_id int, pending_assessment_point_id uuid);
 create table profiles(id uuid primary key, auth_id uuid, role text);
 create table lessons(id uuid primary key, level_id int);
 create table assessment_points(id uuid primary key, after_lesson_id uuid, active boolean);
 create table lesson_records(id uuid primary key);
 create table term_time_followups(id uuid primary key default gen_random_uuid(), student_id uuid references students(id), lesson_record_id uuid not null unique references lesson_records(id) on delete cascade,
   lessons_completed_in_block int not null, status text not null default 'needs_follow_up' check(status in ('needs_follow_up','contacted','extended','not_continuing','snoozed')),
   notes text, created_at timestamptz default now(), updated_at timestamptz default now(), updated_by uuid references profiles(id));
 alter table term_time_followups enable row level security;
 create function is_admin() returns boolean language sql stable as $$ select current_setting('test.staff_role',true)='admin' $$;
 create function is_management() returns boolean language sql stable as $$ select current_setting('test.staff_role',true)='management' $$;
 create function can_access_student(student uuid) returns boolean language sql stable security definer set search_path='' as $$
   select exists(select 1 from public.students where id=student and brand=current_setting('test.brand',true) and (public.is_admin() or centre_id::text=current_setting('test.centre',true))) $$;
 create policy term_time_followups_select on term_time_followups for select using ((is_admin() or is_management()) and can_access_student(student_id));
 create policy term_time_followups_admin_write on term_time_followups for all using (is_admin() and can_access_student(student_id)) with check(is_admin() and can_access_student(student_id));
 create function next_curriculum_lesson(uuid) returns uuid language sql set search_path='public' as $$ select id from lessons limit 1 $$;
 create function advance_after_completion(uuid,uuid,uuid) returns void language sql as $$ select $$;
 grant usage on schema public,auth to authenticated,anon;
 grant all on term_time_followups to authenticated,anon;
 insert into students(id,centre_id,brand) values ('${id(1)}','${id(10)}','robothink'),('${id(2)}','${id(20)}','robothink'),('${id(3)}','${id(10)}','creative_iq');
 insert into profiles(id,auth_id,role) values ('${id(50)}','${id(50)}','instructor');
 insert into lessons(id,level_id) values ('${id(70)}',7);
 insert into lesson_records(id) values ('${id(80)}');
 insert into term_time_followups(student_id,lesson_record_id,lessons_completed_in_block) values ('${id(1)}','${id(80)}',12);
`)
const migration = fs.readdirSync(new URL('../../supabase/migrations/', import.meta.url)).find((p) => p.endsWith('_management_session_followups.sql'))
await db.exec(fs.readFileSync(new URL(`../../supabase/migrations/${migration}`, import.meta.url), 'utf8'))
const q = async (sql, args = []) => (await db.query(sql, args)).rows
const scalar = async (sql, args = []) => Object.values((await q(sql, args))[0])[0]
async function as(role, brand='robothink') {
 await db.exec('reset role')
 for (const [key,value] of [['test.staff_role',role],['test.brand',brand],['test.centre',id(10)],['request.jwt.claim.sub',id(50)]]) await q('select set_config($1,$2,false)',[key,value])
 await db.exec(`set role ${role==='anon'?'anon':'authenticated'}`)
}
const save = (student=id(1), block=1, status='contacted') => q(`insert into term_time_followups(student_id,session_block,status,notes,next_follow_up_date,updated_by)
 values($1,$2,$3,'Parent contacted','2026-11-24',$4) on conflict(student_id,session_block) do update set status=excluded.status returning *`,[student,block,status,id(50)])
await as('management')
assert.equal((await save())[0].session_block,1)
assert.equal((await save(id(1),1,'extended'))[0].status,'extended')
assert.equal(Number(await scalar('select count(*) from term_time_followups where session_block=1')),1)
await assert.rejects(save(id(2)), /row-level security/i)
await assert.rejects(save(id(3)), /row-level security/i)
await assert.rejects(q('update term_time_followups set student_id=$1 where session_block=1',[id(2)]), /row-level security/i)
await assert.rejects(save(id(1),0), /check constraint/i)
assert.equal((await q("update term_time_followups set notes='changed' where session_block is null returning id")).length,0)
await as('instructor')
assert.equal((await q('select * from term_time_followups')).length,0)
await assert.rejects(save(), /row-level security/i)
await as('anon')
assert.equal((await q('select * from term_time_followups')).length,0)
await assert.rejects(save(), /row-level security/i)
await as('admin')
assert.equal((await q('select * from term_time_followups where session_block is null')).length,1)
assert.equal((await q("update term_time_followups set notes='retained' where session_block is null returning *"))[0].notes,'retained')
// Progression keeps working through its internal helper but no longer creates
// a follow-up merely because a curriculum lesson happens to be number 12.
await db.exec('reset role')
await q('select advance_after_completion($1,$2,$3)',[id(1),id(70),id(80)])
assert.equal(await scalar('select current_lesson_id from students where id=$1',[id(1)]),id(70))
assert.equal(Number(await scalar('select count(*) from term_time_followups')),2)
await as('instructor')
await assert.rejects(q('select advance_after_completion($1,$2,$3)',[id(1),id(70),id(80)]), /permission denied/i)
await db.close()
console.log('PASS session-follow-up schema, idempotent decisions, legacy preservation, management/centre/brand RLS, internal progression and helper execution permissions')
