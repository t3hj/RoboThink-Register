import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const db = new PGlite()
const read = path => readFileSync(new URL('../../' + path, import.meta.url), 'utf8')
await db.exec(read('db/tests/fixtures/session_history_schema.sql'))
await db.exec(`
  alter table assessments add student_id uuid, add assessment_point_id uuid, add type text,
    add date date, add created_at timestamptz default now(), add remediation_plan_id uuid, add attempt_number integer;
  alter table remediation_plans add id uuid primary key default gen_random_uuid(), add assessment_id uuid,
    add assessment_point_id uuid, add lessons_completed integer default 0;
  alter table remediation_lessons add remediation_plan_id uuid;
  create table curriculum_progression_log(assessment_id uuid);
  create table assessment_points(id uuid primary key, after_lesson_id uuid, active boolean, focus_topic text);
  alter table lessons add assessment_required boolean default false;
`)
await db.exec(read('supabase/migrations/20261124131500_edit_unfinished_assessment.sql'))
const uuid = n => '00000000-0000-0000-0000-' + String(n).padStart(12, '0')
const [staff, centre, student, lesson, point, session, assessment, plan] = [1, 10, 50, 101, 70, 80, 90, 91].map(uuid)
await db.query("select set_config('request.jwt.claim.sub',$1,false)", [staff])
await db.query('update lessons set assessment_required=true where id=$1', [lesson])
await db.query('insert into assessment_points values ($1,$2,true,null)', [point, lesson])
await db.query('insert into students (id, centre_id) values ($1,$2)', [student, centre])
await db.query("insert into attended_sessions(id,student_id,centre_id,date,session_number,actual_lesson_id,outcome) values ($1,$2,$3,'2026-01-10',1,$4,'completed')", [session, student, centre, lesson])
await db.query("insert into assessments(id,attended_session_id,student_id,assessment_point_id,type,date,attempt_number) values ($1,$2,$3,$4,'curriculum_assessment','2026-01-10',1)", [assessment, session, student, point])
await db.query("insert into feedback_sheets(attended_session_id,status) values ($1,'given')", [session])
const correct = () => db.query("select edit_assessment_history($1,'2026-01-10',$2,'NOT_FINISHED')", [assessment, lesson])
for (const scenario of ['pass', 'unused plan', 'remediation started', 'later assessment']) {
  await db.exec('begin')
  if (scenario.includes('plan') || scenario.includes('remediation')) {
    await db.query("insert into remediation_plans(id,student_id,assessment_id,assessment_point_id,status) values ($1,$2,$3,$4,'required')", [plan, student, assessment, point])
  }
  if (scenario === 'remediation started') {
    await db.query('insert into remediation_lessons(remediation_plan_id) values ($1)', [plan])
    await assert.rejects(correct(), /remediation history/)
  } else if (scenario === 'later assessment') {
    await db.query("insert into assessments(student_id,date) values ($1,'2026-01-11')", [student])
    await assert.rejects(correct(), /latest assessment/)
  } else {
    await correct()
    const { rows } = await db.query(`
      select s.id, s.outcome, f.status, st.pending_assessment_point_id,
        (select count(*)::int from assessments) as results,
        (select count(*)::int from remediation_plans) as plans
      from attended_sessions s join feedback_sheets f on f.attended_session_id=s.id
      join students st on st.id=s.student_id`)
    assert.deepEqual(rows, [{ id: session, outcome: 'not_finished', status: 'given',
      pending_assessment_point_id: point, results: 0, plans: 0 }])
  }
  await db.exec('rollback')
  console.log('PASS', scenario)
}
await db.close()
