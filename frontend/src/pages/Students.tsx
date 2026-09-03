import React, { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'

export default function Students(){
  const [students, setStudents] = useState<any[]>([])

  useEffect(()=>{ load() },[])

  async function load(){
    const { data, error } = await supabase.from('students').select('*').order('full_name')
    if(error) console.error(error)
    if(data) setStudents(data)
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-2xl font-semibold">Students</h2>
        <div>
          <button className="btn-primary mr-2">+ Add student</button>
          <button className="btn-ghost">Export</button>
        </div>
      </div>
      <div className="grid md:grid-cols-3 gap-3">
        {students.map(s=> (
          <Link key={s.id} to={`/students/${s.id}`} className="card p-4 hover:shadow flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <div className="font-medium">{s.full_name}</div>
              <div className="text-sm text-slate-500">{s.active? 'Active':'Inactive'}</div>
            </div>
            <div className="text-sm text-slate-500">{s.preferred_day} · {s.preferred_time}</div>
            <div className="mt-2 text-sm badge">{s.subscription_id===1? 'Elite':'Term Time'}</div>
          </Link>
        ))}
      </div>
    </div>
  )
}
