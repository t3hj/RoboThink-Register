import { PGlite } from '@electric-sql/pglite'
import fs from 'node:fs'
import assert from 'node:assert/strict'
const root=new URL('../../',import.meta.url)
const read=p=>fs.readFileSync(new URL(p,root),'utf8')
const db=new PGlite()
await db.exec(read('db/tests/fixtures/session_history_schema.sql'))
await db.exec(read('supabase/migrations/20261109140804_resume_coding_sequence.sql'))
const migration=read('supabase/migrations/20261109144404_correct_session_lesson_history.sql')
await db.exec(migration)
await db.exec(migration)
const id=n=>'00000000-0000-0000-0000-'+String(n).padStart(12,'0')
const learner=id(50), centre=id(10), staff=id(1), lesson=n=>id(100+n)
const q=async(sql,args=[]) => (await db.query(sql,args)).rows
const scalar=async(sql,args=[]) => Object.values((await q(sql,args))[0])[0]
const reset=async()=>{
 await db.exec('truncate students,lesson_records,attended_sessions,feedback_sheets,term_time_followups,assessments,remediation_lessons,remediation_plans,progress_overrides,audit_log cascade')
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",[staff])
 await db.query('insert into students(id,current_level_id,current_lesson_id,centre_id) values($1,30,$2,$3)',[learner,lesson(21),centre])
}
const seed=async(n=20,date='2026-11-07',outcome='completed',record=null)=>{
 const lr=record??(await q('insert into lesson_records(student_id,level_id,lesson_number,lesson_id,date,instructor_id,status) values($1,30,$2,$3,$4,$5,$6) returning id',[learner,n,lesson(n),date,staff,outcome==='completed'?'completed':'not_completed']))[0].id
 const sn=Number(await scalar('select coalesce(max(session_number),0)+1 from attended_sessions where student_id=$1 and date=$2',[learner,date]))
 const visit=(await q('insert into attended_sessions(student_id,centre_id,date,session_number,actual_lesson_id,lesson_record_id,outcome,instructor_id,created_at) values($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id',[learner,centre,date,sn,lesson(n),lr,outcome,staff,date+'T10:00:00Z']))[0].id
 const feedback=(await q("insert into feedback_sheets(student_id,attended_session_id,lesson_record_id,status) values($1,$2,$3,'written') returning id",[learner,visit,lr]))[0].id
 return {lr,visit,feedback}
}
const edit=(visit,n,outcome='completed')=>q('select update_attended_session($1,$2,$3,false,null,null,null)',[visit,lesson(n),outcome])
let passed=0
async function test(name,fn){await reset();await fn();passed++;console.log('PASS',name)}
await test('correcting a lesson removes only the superseded history and preserves feedback identity/status',async()=>{
 const a=await seed();await edit(a.visit,7)
 assert.equal(await scalar('select count(*)::int from attended_sessions'),1)
 assert.equal(await scalar('select count(*)::int from lesson_records'),1)
 assert.equal(await scalar('select lesson_number from lesson_records'),7)
 const f=(await q('select * from feedback_sheets'))[0]
 assert.equal(f.id,a.feedback);assert.equal(f.status,'written')
 assert.equal(f.lesson_record_id,await scalar('select lesson_record_id from attended_sessions'))
 assert.equal(await scalar('select current_lesson_id from students'),lesson(8))
})
await test('repeated corrections keep one visit and one history entry',async()=>{
 const a=await seed();await edit(a.visit,7);await edit(a.visit,9);await edit(a.visit,9)
 assert.equal(await scalar('select count(*)::int from lesson_records'),1)
 assert.equal(await scalar('select count(*)::int from feedback_sheets'),1)
})
await test('a genuine earlier repeat is kept and its summary restored',async()=>{
 const a=await seed(20,'2026-11-01');const b=await seed(20,'2026-11-07','completed',a.lr)
 await edit(b.visit,7)
 assert.equal(await scalar('select count(*)::int from lesson_records'),2)
 assert.equal(String(await scalar('select date::text from lesson_records where id=$1',[a.lr])),'2026-11-01')
 assert.equal(await scalar('select current_lesson_id from students'),lesson(21))
 assert.equal(await scalar('select lesson_record_id from feedback_sheets where id=$1',[a.feedback]),a.lr)
})
await test('correcting into an existing lesson merges the summary without losing visits',async()=>{
 await seed(7,'2026-11-01');const a=await seed();await edit(a.visit,7)
 assert.equal(await scalar('select count(*)::int from lesson_records'),1)
 assert.equal(await scalar('select count(*)::int from attended_sessions'),2)
 assert.equal(await scalar('select count(*)::int from feedback_sheets'),2)
 assert.equal(await scalar('select date::text from lesson_records'),'2026-11-07')
})
await test('editing an older occurrence does not overwrite a later summary',async()=>{
 await seed(7,'2026-11-08');const a=await seed();await edit(a.visit,7,'not_finished')
 assert.equal(await scalar('select date::text from lesson_records'),'2026-11-08')
 assert.equal(await scalar('select status from lesson_records'),'completed')
 assert.equal(await scalar('select current_lesson_id from students'),lesson(21))
})
await test('correcting completed to unfinished repeats that lesson',async()=>{
 const a=await seed();await edit(a.visit,20,'not_finished')
 assert.equal(await scalar('select current_lesson_id from students'),lesson(20))
})
await test('manual overrides prevent an automatic pointer rewind',async()=>{
 const a=await seed();await q("insert into progress_overrides values($1,30,21,'2026-11-08T10:00:00Z')",[learner]);await edit(a.visit,7)
 assert.equal(await scalar('select current_lesson_id from students'),lesson(21))
})
await test('term follow-ups block destructive correction atomically',async()=>{
 const a=await seed();await q('insert into term_time_followups(lesson_record_id) values($1)',[a.lr])
 await assert.rejects(edit(a.visit,7),/follow-up/)
 assert.equal(await scalar('select actual_lesson_id from attended_sessions'),lesson(20))
})
await test('separate legacy feedback is not silently deleted',async()=>{
 const a=await seed();await q("insert into feedback_sheets(student_id,lesson_record_id,status) values($1,$2,'written')",[learner,a.lr])
 await assert.rejects(edit(a.visit,7),/separate feedback/)
 assert.equal(await scalar('select count(*)::int from feedback_sheets'),2)
})
await test('assessment and project sessions require their own editor',async()=>{
 const a=await seed();await q('insert into assessments(attended_session_id) values($1)',[a.visit]);await assert.rejects(edit(a.visit,7),/assessment editor/)
 await q('delete from assessments');await q('update attended_sessions set project_id=$1,actual_lesson_id=null where id=$2',[id(99),a.visit]);await assert.rejects(edit(a.visit,7),/project or assessment/)
})
await test('summary editing refuses to choose an arbitrary repeated visit',async()=>{
 const a=await seed();await seed(20,'2026-11-08','completed',a.lr)
 await assert.rejects(q("select update_lesson_history($1,'2026-11-07',$2,'completed')",[a.lr,lesson(7)]),/multiple recorded sessions/)
})
await test('single-visit history editor uses the same cleanup and preserves feedback',async()=>{
 const a=await seed();await q("select update_lesson_history($1,'2026-11-07',$2,'completed')",[a.lr,lesson(7)])
 assert.equal(await scalar('select count(*)::int from lesson_records'),1)
 assert.equal(await scalar('select lesson_number from lesson_records'),7)
 assert.equal(await scalar('select id from feedback_sheets'),a.feedback)
})
await test('moving a visit uses a free session number on the destination day',async()=>{
 await seed(7,'2026-11-08');const a=await seed();await q("select update_lesson_history($1,'2026-11-08',$2,'completed')",[a.lr,lesson(9)])
 assert.equal(await scalar('select session_number from attended_sessions where id=$1',[a.visit]),2)
})
await test('linked history cannot be deleted through the unlinked-entry API',async()=>{
 const a=await seed();await assert.rejects(q("select delete_unlinked_lesson_history($1,'mistake')",[a.lr]),/recorded session/)
})
await test('removing an existing ghost preserves session-linked feedback and audits the deletion',async()=>{
 const a=await seed(7);const ghost=(await q("insert into lesson_records(student_id,level_id,lesson_number,lesson_id,date,status) values($1,30,20,$2,'2026-11-07','completed') returning id",[learner,lesson(20)]))[0].id
 await q('update feedback_sheets set lesson_record_id=$1 where id=$2',[ghost,a.feedback])
 await q("select delete_unlinked_lesson_history($1,'confirmed mistaken lesson')",[ghost])
 assert.equal(await scalar('select count(*)::int from attended_sessions'),1)
 assert.equal(await scalar('select lesson_record_id from feedback_sheets'),a.lr)
 assert.equal(await scalar('select status from feedback_sheets'),'written')
 assert.equal(await scalar("select count(*)::int from audit_log where action='remove_unlinked_lesson'"),1)
})
await test('blank reasons, cross-centre access and management callers are blocked',async()=>{
 const a=await seed();await assert.rejects(q("select delete_unlinked_lesson_history($1,'')",[a.lr]),/reason/)
 await q('update attended_sessions set centre_id=$1',[id(11)]);await assert.rejects(edit(a.visit,7),/centre/)
 await q("select set_config('request.jwt.claim.sub',$1,false)",[id(2)]);await assert.rejects(edit(a.visit,7),/authentication/)
 await q("select set_config('request.jwt.claim.sub','',false)");await assert.rejects(edit(a.visit,7),/authentication/)
})
await test('RPCs cannot be executed by anonymous callers',async()=>{
 assert.equal(await scalar("select has_function_privilege('anon','public.delete_unlinked_lesson_history(uuid,text)','execute')"),false)
 assert.equal(await scalar("select has_function_privilege('anon','public.update_attended_session(uuid,uuid,text,boolean,text,text,text)','execute')"),false)
})
console.log(`${passed} session history database scenarios passed`)
await db.close()
