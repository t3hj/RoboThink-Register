import { PGlite } from '@electric-sql/pglite'
import fs from 'node:fs'
const root = new URL('../../', import.meta.url).pathname
const migration = fs.readFileSync(root+'/supabase/migrations/20261109140804_resume_coding_sequence.sql','utf8')
const db = new PGlite()
await db.exec(`
create role anon; create role authenticated; create schema auth;
create function auth.uid() returns uuid language sql as $$ select '00000000-0000-0000-0000-000000000001'::uuid $$;
create table public.profiles (auth_id uuid, role text);
insert into profiles values ('00000000-0000-0000-0000-000000000001', 'instructor');
create table levels (id int primary key, slug text);
insert into levels values (30,'coding'),(1,'junior');
create table lessons (id uuid primary key, level_id int, lesson_number int, lesson_kind text);
insert into lessons select ('00000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,30,n,'normal' from generate_series(1,40) n;
create table students (id uuid primary key,current_lesson_id uuid,pending_assessment_point_id uuid,override_next_lesson int);
create table remediation_plans (student_id uuid,status text);
create table progress_overrides (student_id uuid,new_level_id int,new_lesson int default 30,created_at timestamptz);
create table attended_sessions (id uuid primary key,student_id uuid,actual_lesson_id uuid,lesson_record_id uuid,outcome text,date date,session_number int,created_at timestamptz);
create function public.can_access_student(uuid) returns boolean language sql as $$ select true $$;
create function public.next_curriculum_lesson(uuid) returns uuid language sql as $$ select b.id from public.lessons a join public.lessons b on b.level_id=a.level_id and b.lesson_number=a.lesson_number+1 where a.id=$1 $$;
create function public.lesson_is_at_or_beyond(uuid,uuid) returns boolean language sql as $$ select a.lesson_number>=b.lesson_number from public.lessons a,public.lessons b where a.id=$1 and b.id=$2 $$;
create function public.advance_after_completion(uuid,uuid,uuid) returns void language sql as $$ update public.students set current_lesson_id=public.next_curriculum_lesson($2) where id=$1 $$;
`)
await db.exec(migration)
await db.exec(migration) // repeatable deployment
const id=n=>'00000000-0000-0000-0000-'+String(n).padStart(12,'0')
async function scenario(name, tail, expected, setup='') {
 await db.exec('truncate students,attended_sessions,remediation_plans,progress_overrides;')
 await db.query('insert into students(id,current_lesson_id) values($1,$2)',[id(100),id(21)])
 await db.exec(setup)
 for(let i=0;i<tail.length;i++) {
  const [n,outcome='completed',day=i+1]=Array.isArray(tail[i])?tail[i]:[tail[i]]
  await db.query('insert into attended_sessions values($1,$2,$3,null,$4,$5,1,$6)',[id(200+i),id(100),id(n),outcome,`2026-01-${String(day).padStart(2,'0')}`,`2026-01-${String(day).padStart(2,'0')}T10:00:00Z`])
  await db.query('update attended_sessions set lesson_record_id=$1 where id=$2',[id(500+i),id(200+i)])
 }
 const actual=(await db.query('select l.lesson_number from students s join lessons l on l.id=s.current_lesson_id')).rows[0].lesson_number
 if(actual!==expected) throw new Error(`${name}: expected ${expected}, got ${actual}`)
 console.log('PASS',name)
}
await scenario('20 -> 5 -> 6 resets to 7',[20,5,6],7)
await scenario('single catch-up stays at 21',[20,5],21)
await scenario('repeat stays at 21',[20,5,5],21)
await scenario('gap stays at 21',[20,5,7],21)
await scenario('unfinished breaks sequence',[20,5,[6,'not_finished']],21)
await scenario('unfinished first attempt breaks sequence',[20,[5,'not_finished'],6],21)
await scenario('explicit override preserved',[20,5,6],21,'update students set override_next_lesson=30')
await scenario('pending assessment preserved',[20,5,6],21,`update students set pending_assessment_point_id='${id(800)}'`)
await scenario('remediation preserved',[20,5,6],21,`insert into remediation_plans values('${id(100)}','required')`)
await scenario('checkpoint separates the pair',[20,5,[6,'completed',4]],21,`insert into progress_overrides(student_id,new_level_id,created_at) values('${id(100)}',30,'2026-01-03T10:00:00Z')`)
await scenario('backdated insert cannot rewind current pointer',[20,[5,'completed',5],[6,'completed',3]],21)
await db.exec("create or replace function public.can_access_student(uuid) returns boolean language sql as $$ select false $$")
await scenario('inaccessible students cannot trigger progression',[20,5,6],21)
await db.exec("create or replace function public.can_access_student(uuid) returns boolean language sql as $$ select true $$")
const permissions = (await db.query("select has_function_privilege('anon','private.resume_coding_sequence()','execute') as anon, has_function_privilege('authenticated','private.resume_coding_sequence()','execute') as staff")).rows[0]
if (permissions.anon || permissions.staff) throw new Error('Trigger function must not be callable as an API')
console.log('PASS trigger has no direct API execute grants')
await db.exec("update profiles set role='management'")
await scenario('management does not trigger progression',[20,5,6],21)
console.log('Coding SQL scenarios passed')
await db.close()

// Exercise the complete staff-approval migration with and without the legacy
// function. These fixtures contain schema and synthetic identities only.
const authMigration = fs.readFileSync(root+'/supabase/migrations/20261103132626_staff_approval_for_social_login.sql','utf8')
for (const legacy of [false, true]) {
  const authDb = new PGlite()
  await authDb.exec(`
    create role anon; create role authenticated; create schema auth;
    create table auth.users (id uuid, email text, email_confirmed_at timestamptz);
    create table public.profiles (id uuid,auth_id uuid,name text,email text,role text);
    create function auth.uid() returns uuid language sql as $$ select null::uuid $$;
    create function public.is_admin() returns boolean language sql as $$ select false $$;
  `)
  if (legacy) await authDb.exec(`
    create function public.handle_new_user() returns trigger language plpgsql as $$ begin return new; end $$;
    create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();
  `)
  await authDb.exec(authMigration)
  await authDb.exec(authMigration)
  const checks = (await authDb.query(`select
    to_regprocedure('public.approve_staff(text,text,text)') is not null as approval_exists,
    exists(select 1 from pg_trigger where tgname='on_auth_user_created') as unsafe_trigger,
    case when to_regprocedure('public.handle_new_user()') is not null then
      has_function_privilege('anon',to_regprocedure('public.handle_new_user()'),'execute') else false end as anon_legacy_execute
  `)).rows[0]
  if (!checks.approval_exists || checks.unsafe_trigger || checks.anon_legacy_execute) throw new Error('Staff approval migration safety check failed')
  console.log('PASS staff approval migration, legacy function '+(legacy ? 'present' : 'absent'))
  await authDb.close()
}
