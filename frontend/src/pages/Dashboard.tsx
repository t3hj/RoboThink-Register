import React, { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'

function dayName(dateStr:string){
  const d = new Date(dateStr+'T12:00:00')
  return ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][d.getDay()]
}

export default function Dashboard(){
  const [students, setStudents] = useState<any[]>([])
  const [today] = useState<string>((new Date()).toISOString().slice(0,10))

  useEffect(()=>{
    fetchStudents()
  },[])

  async function fetchStudents(){
    const { data:studentsData, error } = await supabase.from('students').select('*')
    if(error) { console.error(error); return }
    if(!studentsData) return
    // For each student, fetch next lesson via RPC
    const withNext = await Promise.all(studentsData.map(async (s:any)=>{
      try{
        const { data:rpc } = await supabase.rpc('compute_next_lesson', { in_student: s.id })
        return { ...s, nextLesson: rpc }
      }catch(e){ return { ...s, nextLesson: null } }
    }))
    setStudents(withNext)
  }

  const arrived = students.length ? students.filter(s=>s.nextLesson!=null).length : 0

  return (
    <div>
      <div className="mb-4 flex justify-between items-center">
        <div>
          <div className="text-sm text-slate-500">{dayName(today)}</div>
          <h2 className="text-2xl font-semibold">Today at a glance</h2>
        </div>
        <div className="flex items-center gap-2">
          <button className="btn-primary">Take Register</button>
          <button className="btn-ghost">Add Student</button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="card p-4 text-center">
          <div className="text-3xl font-bold">{students.length}</div>
          <div className="text-sm text-slate-500">Total students</div>
        </div>
        <div className="card p-4 text-center">
          <div className="text-3xl font-bold">{arrived}</div>
          <div className="text-sm text-slate-500">Example stat</div>
        </div>
        <div className="card p-4 text-center">
          <div className="text-3xl font-bold">—</div>
          <div className="text-sm text-slate-500">Arrived</div>
        </div>
        <div className="card p-4 text-center">
          <div className="text-3xl font-bold">—</div>
          <div className="text-sm text-slate-500">In session</div>
        </div>
      </div>

      <div className="card p-4">
        <h3 className="font-semibold mb-3">Students</h3>
        <div className="grid md:grid-cols-2 gap-3">
          {students.map(s=> (
            <div key={s.id} className="p-3 border rounded-lg flex items-center justify-between hover:shadow">
              <div>
                <div className="font-medium">{s.full_name}</div>
                <div className="text-sm text-slate-500">{s.preferred_day} · {s.preferred_time}</div>
              </div>
              <div className="text-sm text-right">
                <div className="badge">Next: {s.nextLesson || '—'}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
