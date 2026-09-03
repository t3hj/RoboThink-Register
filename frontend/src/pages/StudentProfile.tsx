import React, { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'

export default function StudentProfile(){
  const { id } = useParams()
  const [student, setStudent] = useState<any>(null)
  const [lessons, setLessons] = useState<any[]>([])
  const [attendance, setAttendance] = useState<any[]>([])

  useEffect(()=>{ if(id) load() },[id])

  async function load(){
    const { data: s } = await supabase.from('students').select('*').eq('id', id).maybeSingle()
    setStudent(s)
    const { data: ls } = await supabase.from('lesson_records').select('*').eq('student_id', id).order('date', {ascending:false})
    setLessons(ls || [])
    const { data: at } = await supabase.from('attendance').select('*').eq('student_id', id).order('date', {ascending:false})
    setAttendance(at || [])
  }

  async function setOverride(){
    const val = prompt('Set next lesson number (numeric):')
    if(!val) return
    const num = parseInt(val,10)
    if(isNaN(num)) { alert('Invalid number'); return }
    const { error } = await supabase.from('students').update({ override_next_lesson: num }).eq('id', id)
    if(error) { alert('Error: '+error.message); return }
    await supabase.from('progress_overrides').insert([{ student_id: id, previous_lesson: null, new_lesson: num, reason: 'Manual override from UI', admin_id: null }])
    load()
  }

  if(!student) return <div>Loading...</div>

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <Link to="/students" className="text-sm text-slate-500 underline">← Back to students</Link>
          <h2 className="text-2xl font-semibold">{student.full_name}</h2>
          <div className="text-sm text-slate-500">{student.preferred_day} · {student.preferred_time} · {student.parent_name}</div>
        </div>
        <div className="flex gap-2">
          <button onClick={setOverride} className="btn-ghost">Manual override</button>
          <button className="btn-primary">Edit profile</button>
        </div>
      </div>

      <div className="grid md:grid-cols-3 gap-4">
        <div className="card p-4 md:col-span-1">
          <h3 className="font-semibold mb-3">Progress</h3>
          <div className="text-sm text-slate-500">Level</div>
          <div className="font-medium mb-3">{student.current_level_id}</div>
          <div className="text-sm text-slate-500">Subscription</div>
          <div className="font-medium">{student.subscription_id===1? 'Elite':'Term Time'}</div>
        </div>

        <div className="card p-4 md:col-span-2">
          <h3 className="font-semibold mb-3">Lesson history</h3>
          {lessons.length? lessons.map(l=> (
            <div key={l.id} className="border-b py-2">
              <div className="flex justify-between"><div>Lesson {l.lesson_number}</div><div className="text-sm text-slate-500">{l.date}</div></div>
            </div>
          )) : <div className="text-sm text-slate-500">No lessons recorded.</div>}

          <h3 className="font-semibold mt-4 mb-3">Attendance</h3>
          {attendance.length? attendance.map(a=> (
            <div key={a.id} className="border-b py-2">
              <div className="flex justify-between"><div>{a.date}{a.catch_up? ' · Catch-up':''}</div><div className="text-sm text-slate-500">{a.status}</div></div>
              <div className="text-sm text-slate-500">{a.time_in || '–'} → {a.time_out || '–'}</div>
            </div>
          )) : <div className="text-sm text-slate-500">No attendance recorded.</div>}
        </div>
      </div>
    </div>
  )
}
