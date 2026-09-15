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
import InstructorAnalytics from './pages/InstructorAnalytics'
import ManagementDashboard from './pages/ManagementDashboard'
import StaffManagement from './pages/StaffManagement'
import NotFound from './pages/NotFound'
import type { Role } from './types'

/** Each route lists which roles can see it. Management gets its own,
 *  separate, read-only area rather than the day-to-day operational pages —
 *  RLS enforces the read-only part server-side; this just keeps their UI
 *  clean and on-topic. */
const NAV: { to: string; label: string; end?: boolean; roles: Role[] }[] = [
  { to: '/', label: 'Dashboard', end: true, roles: ['admin', 'instructor'] },
  { to: '/register', label: "Today's Register", roles: ['admin', 'instructor'] },
  { to: '/students', label: 'Students', roles: ['admin', 'instructor'] },
  { to: '/curriculum', label: 'Curriculum', roles: ['admin', 'instructor'] },
  { to: '/reports', label: 'Reports', roles: ['admin', 'instructor'] },
  { to: '/analytics', label: 'Analytics', roles: ['admin', 'instructor'] },
  { to: '/management', label: 'Management dashboard', roles: ['admin', 'management'] },
  { to: '/staff', label: 'Staff', roles: ['admin'] },
]

function homeFor(role: Role | null): string {
  if (role === 'management') return '/management'
  return '/'
}

/** Redirects away from a route the current role isn't allowed on, straight
 *  to that role's home. A safety net alongside RLS, not a replacement for
 *  it — RLS is what actually stops management from writing data. */
function RoleRoute({ roles, children }: { roles: Role[]; children: React.ReactNode }) {
  const { role } = useAuth()
  if (role && !roles.includes(role)) return <Navigate to={homeFor(role)} replace />
  return <>{children}</>
}

function Layout() {
  const { profile, role, signOut } = useAuth()
  const items = NAV.filter((item) => !role || item.roles.includes(role))
  return (
    <div className="min-h-screen bg-[color:var(--rt-paper)] text-[color:var(--rt-ink)]">
      <a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 btn-primary">
        Skip to content
      </a>
      <div className="brand-stripe" aria-hidden />
      <div className="max-w-7xl mx-auto px-4 py-4 lg:py-6 grid grid-cols-1 lg:grid-cols-5 gap-6">
        <aside className="lg:col-span-1">
          <div className="card p-4 lg:sticky lg:top-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-[color:var(--rt-primary)] flex items-center justify-center text-white font-bold shrink-0">RT</div>
              <div>
                <div className="text-lg font-semibold leading-tight">RoboThink</div>
                <div className="text-xs text-slate-500">Register & Progress</div>
              </div>
            </div>
            <nav className="flex lg:flex-col gap-1 overflow-x-auto -mx-1 px-1 pb-1" aria-label="Main navigation">
              {items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) =>
                    `px-3 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
                      isActive ? 'bg-[color:var(--rt-primary)] text-white' : 'text-slate-600 hover:bg-slate-100'
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

        <main id="main-content" className="lg:col-span-4 min-w-0">
          <Routes>
            <Route path="/" element={<RoleRoute roles={['admin', 'instructor']}><Dashboard /></RoleRoute>} />
            <Route path="/register" element={<RoleRoute roles={['admin', 'instructor']}><Register /></RoleRoute>} />
            <Route path="/students" element={<RoleRoute roles={['admin', 'instructor']}><Students /></RoleRoute>} />
            <Route path="/students/:id" element={<RoleRoute roles={['admin', 'instructor']}><StudentProfile /></RoleRoute>} />
            <Route path="/curriculum" element={<RoleRoute roles={['admin', 'instructor']}><Curriculum /></RoleRoute>} />
            <Route path="/reports" element={<RoleRoute roles={['admin', 'instructor']}><Reports /></RoleRoute>} />
            <Route path="/analytics" element={<RoleRoute roles={['admin', 'instructor']}><InstructorAnalytics /></RoleRoute>} />
            <Route path="/management" element={<RoleRoute roles={['admin', 'management']}><ManagementDashboard /></RoleRoute>} />
            <Route path="/staff" element={<RoleRoute roles={['admin']}><StaffManagement /></RoleRoute>} />
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
