import React, { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'

const todayISO = ()=> new Date().toISOString().slice(0,10)
const dayName = (iso:string) => { const d=new Date(iso+'T12:00:00'); return ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][d.getDay()]; }

export default function Register(){
  const [date, setDate] = useState<string>(todayISO())
  const [roster, setRoster] = useState<any[]>([])

  useEffect(()=>{ loadRoster() },[date])

  async function loadRoster(){
    const dow = dayName(date)
    const { data:stu } = await supabase.from('students').select('*').or(`preferred_day.eq.${dow}`)
    const { data:att } = await supabase.from('attendance').select('student_id').eq('date', date)
    const ids = new Set(stu?.map((s:any)=>s.id))
    att?.forEach((a:any)=> ids.add(a.student_id))
    const students = await supabase.from('students').select('*').in('id',[...ids])
    if(students.error) { console.error(students.error); return }
    const enriched = await Promise.all((students.data||[]).map(async (s:any)=>{
      const { data:attRec } = await supabase.from('attendance').select('*').eq('student_id', s.id).eq('date', date).maybeSingle()
      let next = null
      try{ const { data:rpc } = await supabase.rpc('compute_next_lesson', { in_student: s.id }); next = rpc }catch(e){ next = null }
      return { ...s, attendance: attRec, nextLesson: next }
    }))
    setRoster(enriched)
  }

  async function markArrived(studentId:string){
    const now = new Date();
    const timeStr = now.toTimeString().slice(0,5)
    const { error } = await supabase.from('attendance').upsert({ student_id: studentId, date, scheduled_day: dayName(date), actual_day: dayName(date), time_in: timeStr, status:'Arrived' }, { onConflict:['student_id','date'] })
    if(error) { alert('Error: '+error.message); return }
    loadRoster()
  }

  async function markAbsent(studentId:string){
    const { error } = await supabase.from('attendance').upsert({ student_id: studentId, date, scheduled_day: dayName(date), actual_day: dayName(date), status:'Absent' }, { onConflict:['student_id','date'] })
    if(error) { alert('Error: '+error.message); return }
    loadRoster()
  }

  async function markTimeOut(studentId:string){
    const now = new Date(); const timeStr = now.toTimeString().slice(0,5)
    const { data, error } = await supabase.from('attendance').update({ time_out: timeStr }).match({ student_id: studentId, date })
    if(error) { alert('Error: '+error.message); return }
    loadRoster()
  }

  async function completeLesson(student:any){
    if(!confirm(`Mark ${student.full_name} as completing next lesson (${student.nextLesson})?`)) return
    const { error } = await supabase.from('lesson_records').insert([{
      student_id: student.id,
      level_id: student.current_level_id,
      lesson_number: student.nextLesson,
      date,
      instructor_id: null,
      status: 'completed'
    }])
    if(error){ alert('Error: '+error.message); return }
    await supabase.from('attendance').upsert({ student_id: student.id, date, status:'Completed' }, { onConflict:['student_id','date'] })
    loadRoster()
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <div className="text-sm text-slate-500">Register</div>
          <h2 className="text-2xl font-semibold">{date}</h2>
        </div>
        <div className="flex items-center gap-2">
          <input type="date" value={date} onChange={e=>setDate(e.target.value)} className="p-2 border rounded" />
        </div>
      </div>

      <div className="card p-3 space-y-2">
        {roster.length? roster.map(s=> (
          <div key={s.id} className="flex items-center justify-between gap-4 p-3 border rounded-lg hover:shadow-sm">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-md bg-slate-100 flex items-center justify-center text-sm font-semibold">{s.full_name.split(' ').map(n=>n[0]).slice(0,2).join('')}</div>
              <div>
                <div className="font-medium">{s.full_name} <span className="text-xs text-slate-500">· {s.preferred_day} {s.preferred_time}</span></div>
                <div className="text-sm text-slate-500">{s.subscription_id===1? 'Elite':'Term Time'}</div>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="text-sm text-slate-500">Next</div>
              <div className="badge">{s.nextLesson || '—'}</div>
              <div>
                {!s.attendance || s.attendance.status==='Not Arrived' ? (
                  <>
                    <button onClick={()=>markArrived(s.id)} className="btn-primary">Arrived</button>
                    <button onClick={()=>markAbsent(s.id)} className="btn-ghost ml-2">Absent</button>
                  </>
                ) : s.attendance.status==='Arrived' ? (
                  <>
                    <button onClick={()=>markTimeOut(s.id)} className="btn-ghost">Time Out</button>
                    <button onClick={()=>completeLesson(s)} className="btn-primary ml-2">Mark Done</button>
                  </>
                ) : (
                  <div className="badge">{s.attendance.status}</div>
                )}
              </div>
            </div>
          </div>
        )) : <div className="text-sm text-slate-500">No students scheduled or attending today.</div>}
      </div>
    </div>
  )
}
