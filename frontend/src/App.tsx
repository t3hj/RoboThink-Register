import { BrowserRouter, Routes, Route, NavLink, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './lib/auth'
import { ToastProvider } from './components/Toast'
import { LoadingPanel } from './components/ui'
import Auth from './pages/Auth'
import Dashboard from './pages/Dashboard'
import Register from './pages/Register'
import Students from './pages/Students'
import StudentProfile from './pages/StudentProfile'
import Curriculum from './pages/Curriculum'
import Reports from './pages/Reports'
import NotFound from './pages/NotFound'

const NAV = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/register', label: "Today's Register" },
  { to: '/students', label: 'Students' },
  { to: '/curriculum', label: 'Curriculum' },
  { to: '/reports', label: 'Reports' },
]

function Layout() {
  const { profile, signOut } = useAuth()
  return (
    <div className="min-h-screen bg-[color:var(--rt-paper)] text-[color:var(--rt-ink)]">
      <div className="max-w-7xl mx-auto px-4 py-4 lg:py-6 grid grid-cols-1 lg:grid-cols-5 gap-6">
        <aside className="lg:col-span-1">
          <div className="card p-4 lg:sticky lg:top-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-[color:var(--rt-teal)] flex items-center justify-center text-white font-bold shrink-0">RT</div>
              <div>
                <div className="text-lg font-semibold leading-tight">RoboThink</div>
                <div className="text-xs text-slate-500">Register & Progress</div>
              </div>
            </div>
            <nav className="flex lg:flex-col gap-1 overflow-x-auto -mx-1 px-1 pb-1" aria-label="Main navigation">
              {NAV.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) =>
                    `px-3 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
                      isActive ? 'bg-[color:var(--rt-teal)] text-white' : 'text-slate-600 hover:bg-slate-100'
                    }`
                  }
                >
                  {item.label}
                </NavLink>
              ))}
            </nav>
            <div className="mt-4 pt-3 border-t border-slate-100 hidden lg:block">
              <div className="text-sm font-medium truncate">{profile?.name ?? 'Signed in'}</div>
              <div className="text-xs text-slate-500 capitalize mb-2">{profile?.role ?? 'staff'}</div>
              <button onClick={() => void signOut()} className="btn-ghost w-full text-sm">Sign out</button>
            </div>
          </div>
          <button onClick={() => void signOut()} className="btn-ghost w-full mt-3 lg:hidden text-sm">
            Sign out{profile ? ` (${profile.name})` : ''}
          </button>
        </aside>

        <main className="lg:col-span-4 min-w-0">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/register" element={<Register />} />
            <Route path="/students" element={<Students />} />
            <Route path="/students/:id" element={<StudentProfile />} />
            <Route path="/curriculum" element={<Curriculum />} />
            <Route path="/reports" element={<Reports />} />
            <Route path="/dashboard" element={<Navigate to="/" replace />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </main>
      </div>
    </div>
  )
}

function Protected() {
  const { user, loading } = useAuth()

  if (loading) {
    return (
      <div className="min-h-screen bg-[color:var(--rt-paper)] flex items-center justify-center p-6">
        <LoadingPanel label="Checking your session…" />
      </div>
    )
  }
  if (!user) return <Auth />
  return <Layout />
}

export default function App() {
  return (
    <ToastProvider>
      <AuthProvider>
        <BrowserRouter>
          <Protected />
        </BrowserRouter>
      </AuthProvider>
    </ToastProvider>
  )
}
