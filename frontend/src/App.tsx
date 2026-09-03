import React, { useEffect, useState } from 'react'
import { BrowserRouter, Routes, Route, Link } from 'react-router-dom'
import { supabase } from './lib/supabaseClient'
import Auth from './pages/Auth'
import Dashboard from './pages/Dashboard'
import Register from './pages/Register'
import Students from './pages/Students'
import StudentProfile from './pages/StudentProfile'

export default function App(){
  const [user, setUser] = useState<any>(null)

  useEffect(()=>{
    supabase.auth.getSession().then(({ data })=> setUser(data.session?.user ?? null))
    const { data:sub } = supabase.auth.onAuthStateChange((_event, session)=>{
      setUser(session?.user ?? null)
    })
    return ()=>{ sub?.subscription.unsubscribe() }
  },[])

  if(!user) return <Auth />

  return (
    <BrowserRouter>
      <div className="min-h-screen bg-[color:var(--rt-paper)] text-[color:var(--rt-ink)]">
        <div className="max-w-7xl mx-auto px-4 py-6 grid grid-cols-1 md:grid-cols-5 gap-6">
          <aside className="md:col-span-1">
            <div className="card p-4 sticky top-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-full bg-[color:var(--rt-teal)] flex items-center justify-center text-white font-bold">RT</div>
                <div>
                  <div className="text-lg font-semibold">RoboThink</div>
                  <div className="text-xs text-slate-500">Register & Progress</div>
                </div>
              </div>
              <nav className="flex flex-col gap-2">
                <Link to="/" className="px-3 py-2 rounded-lg hover:bg-slate-50">Dashboard</Link>
                <Link to="/register" className="px-3 py-2 rounded-lg hover:bg-slate-50">Today's Register</Link>
                <Link to="/students" className="px-3 py-2 rounded-lg hover:bg-slate-50">Students</Link>
                <Link to="/curriculum" className="px-3 py-2 rounded-lg hover:bg-slate-50">Curriculum</Link>
                <Link to="/reports" className="px-3 py-2 rounded-lg hover:bg-slate-50">Reports</Link>
                <button onClick={async ()=>{ await supabase.auth.signOut(); setUser(null) }} className="mt-3 btn-ghost w-full">Sign out</button>
              </nav>
            </div>
          </aside>

          <main className="md:col-span-4">
            <div className="flex items-center justify-between mb-4">
              <div>
                <div className="text-sm text-slate-500">Welcome back</div>
                <h1 className="text-2xl font-semibold">RoboThink Dashboard</h1>
              </div>
            </div>

            <div className="space-y-6">
              <Routes>
                <Route path="/" element={<Dashboard />} />
                <Route path="/register" element={<Register />} />
                <Route path="/students" element={<Students />} />
                <Route path="/students/:id" element={<StudentProfile />} />
              </Routes>
            </div>
          </main>
        </div>
      </div>
    </BrowserRouter>
  )
}
