-- Synthetic, offline fixture. No production identities or learner data.
create role anon; create role authenticated; create role service_role;
create schema auth;
create function auth.uid() returns uuid language sql set search_path=public as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
create table profiles(id uuid primary key,auth_id uuid,role text);
insert into profiles values
 ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','instructor'),
 ('00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000002','management');
create table levels(id integer primary key,slug text);
insert into levels values(30,'coding');
create table lessons(id uuid primary key,level_id integer,lesson_number integer,lesson_kind text);
insert into lessons select ('00000000-0000-0000-0000-'||lpad((100+n)::text,12,'0'))::uuid,30,n,'normal' from generate_series(1,40) n;
create table students(id uuid primary key,current_level_id integer,current_lesson_id uuid,pending_assessment_point_id uuid,override_next_lesson integer,centre_id uuid);
create table lesson_records(id uuid primary key default gen_random_uuid(),student_id uuid references students(id),level_id integer,lesson_number integer,lesson_id uuid,date date,instructor_id uuid,status text,created_at timestamptz default now(),unique(student_id,level_id,lesson_number));
create table attended_sessions(id uuid primary key default gen_random_uuid(),student_id uuid references students(id),centre_id uuid,date date,session_number integer,actual_lesson_id uuid,lesson_record_id uuid references lesson_records(id),project_id uuid,outcome text,instructor_id uuid,created_at timestamptz default now(),left_aside boolean default false,left_aside_identifier text,left_aside_reason text,left_aside_note text,unique(student_id,date,session_number));
create table feedback_sheets(id uuid primary key default gen_random_uuid(),student_id uuid,attended_session_id uuid references attended_sessions(id),lesson_record_id uuid references lesson_records(id) on delete cascade,status text,updated_by uuid);
create table term_time_followups(id uuid primary key default gen_random_uuid(),lesson_record_id uuid references lesson_records(id) on delete cascade);
create table assessments(id uuid primary key default gen_random_uuid(),attended_session_id uuid references attended_sessions(id));
create table remediation_lessons(id uuid primary key default gen_random_uuid(),attended_session_id uuid references attended_sessions(id));
create table remediation_plans(student_id uuid,status text);
create table progress_overrides(student_id uuid,new_level_id integer,new_lesson integer,created_at timestamptz);
create table audit_log(actor_id uuid,action text,object_type text,object_id text,before jsonb,after jsonb);
create function can_access_centre(uuid) returns boolean language sql set search_path=public as $$select coalesce($1='00000000-0000-0000-0000-000000000010'::uuid,false)$$;
create function can_access_student(uuid) returns boolean language sql set search_path=public as $$select coalesce((select can_access_centre(centre_id) from students where id=$1),false)$$;
create function next_curriculum_lesson(uuid) returns uuid language sql set search_path=public as $$select b.id from lessons a join lessons b on b.level_id=a.level_id and b.lesson_number>a.lesson_number where a.id=$1 and b.lesson_kind='normal' order by b.lesson_number limit 1$$;
create function lesson_is_at_or_beyond(uuid,uuid) returns boolean language sql set search_path=public as $$select coalesce((select a.level_id=b.level_id and a.lesson_number>=b.lesson_number from lessons a,lessons b where a.id=$1 and b.id=$2),false)$$;
create function advance_after_completion(uuid,uuid,uuid) returns void language sql set search_path=public as $$update students set current_lesson_id=next_curriculum_lesson($2),current_level_id=(select level_id from lessons where id=$2),pending_assessment_point_id=null where id=$1$$;
