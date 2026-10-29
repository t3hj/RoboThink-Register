import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { AuthProvider, useAuth } from './lib/auth'
import { CentreProvider } from './lib/centres'
import { BrandProvider, useBrand } from './lib/brand'
import { ToastProvider } from './components/Toast'
import { LoadingPanel } from './components/ui'
import AppNavigation from './components/AppNavigation'
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
import Help from './pages/Help'
import Requests from './pages/Requests'
import ImportStudents from './pages/ImportStudents'
import NotFound from './pages/NotFound'
import type { Role } from './types'

/** Each route lists which roles can see it. Management gets its own,
 *  separate, read-only area rather than the day-to-day operational pages —
 *  RLS enforces the read-only part server-side; this just keeps their UI
 *  clean and on-topic. */
const NAV: { to: string; label: string; end?: boolean; roles: Role[] }[] = [
  { to: '/', label: 'Dashboard', end: true, roles: ['admin', 'instructor'] },
  { to: '/register', label: "Today's Register", roles: ['admin', 'instructor'] },
  { to: '/students', label: 'Students', roles: ['admin', 'instructor', 'management'] },
  { to: '/requests', label: 'Student requests', roles: ['admin', 'instructor', 'management'] },
  { to: '/import', label: 'Import from Pebble', roles: ['admin', 'management'] },
  { to: '/curriculum', label: 'Curriculum', roles: ['admin', 'instructor'] },
  { to: '/reports', label: 'Reports', roles: ['admin', 'instructor'] },
  { to: '/analytics', label: 'Analytics', roles: ['admin', 'instructor'] },
  { to: '/management', label: 'Management dashboard', roles: ['admin', 'management'] },
  { to: '/staff', label: 'Staff', roles: ['admin'] },
  { to: '/help', label: 'Help & guides', roles: ['admin', 'instructor', 'management'] },
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
  const { role } = useAuth()
  const { activeBrand } = useBrand()
  const { pathname } = useLocation()
  const items = NAV.filter((item) => !role || item.roles.includes(role))
  return (
    <div data-brand={activeBrand} className="min-h-screen bg-[color:var(--rt-paper)] text-[color:var(--rt-ink)]">
      <a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 btn-primary">
        Skip to content
      </a>
      <div className="brand-stripe" aria-hidden />
      <div className="max-w-7xl mx-auto px-3 sm:px-4 py-3 sm:py-4 lg:py-6 grid grid-cols-1 lg:grid-cols-5 gap-4 sm:gap-6">
        <AppNavigation items={items} />

        <main id="main-content" className="lg:col-span-4 min-w-0">
          <div key={`${activeBrand}:${pathname}`} className="page-enter">
          <Routes>
            <Route path="/" element={<RoleRoute roles={['admin', 'instructor']}><Dashboard /></RoleRoute>} />
            <Route path="/register" element={<RoleRoute roles={['admin', 'instructor']}><Register /></RoleRoute>} />
            <Route path="/students" element={<RoleRoute roles={['admin', 'instructor', 'management']}><Students /></RoleRoute>} />
            <Route path="/students/:id" element={<RoleRoute roles={['admin', 'instructor', 'management']}><StudentProfile /></RoleRoute>} />
            <Route path="/requests" element={<RoleRoute roles={['admin', 'instructor', 'management']}><Requests /></RoleRoute>} />
            <Route path="/import" element={<RoleRoute roles={['admin', 'management']}><ImportStudents /></RoleRoute>} />
            <Route path="/curriculum" element={<RoleRoute roles={['admin', 'instructor']}><Curriculum /></RoleRoute>} />
            <Route path="/reports" element={<RoleRoute roles={['admin', 'instructor']}><Reports /></RoleRoute>} />
            <Route path="/analytics" element={<RoleRoute roles={['admin', 'instructor']}><InstructorAnalytics /></RoleRoute>} />
            <Route path="/management" element={<RoleRoute roles={['admin', 'management']}><ManagementDashboard /></RoleRoute>} />
            <Route path="/staff" element={<RoleRoute roles={['admin']}><StaffManagement /></RoleRoute>} />
            <Route path="/dashboard" element={<Navigate to="/" replace />} />
            <Route path="/help" element={<Help />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
          </div>
        </main>
      </div>
    </div>
  )
}

function Protected() {
  const { user, profile, role, loading, profileError, retryProfile, signOut } = useAuth()

  if (loading) {
    return (
      <div className="min-h-screen bg-[color:var(--rt-paper)] flex items-center justify-center p-6">
        <LoadingPanel label="Checking your session…" />
      </div>
    )
  }
  if (!user) return <Auth />
  if (!profile || !role || !['admin', 'instructor', 'management'].includes(role)) {
    return (
      <div className="min-h-screen bg-[color:var(--rt-paper)] flex items-center justify-center p-6">
        <section className="card p-6 max-w-md w-full" aria-labelledby="staff-access-title">
          <h1 id="staff-access-title" className="text-xl mb-2">{profileError ? 'Unable to load staff access' : 'Staff access not configured'}</h1>
          <p className="text-sm text-slate-600 mb-4" role={profileError ? 'alert' : undefined}>
            {profileError ?? 'You are signed in, but your account is not linked to an authorised staff profile. Please contact your administrator to enable access.'}
          </p>
          <div className="flex flex-wrap gap-2">
            <button className="btn-primary" onClick={retryProfile}>Try again</button>
            <button className="btn-ghost" onClick={() => void signOut()}>Sign out</button>
          </div>
        </section>
      </div>
    )
  }
  return <Layout />
}

export default function App() {
  return (
    <ToastProvider>
      <AuthProvider>
        <BrowserRouter>
          <BrandProvider>
            <CentreProvider>
              <Protected />
            </CentreProvider>
          </BrandProvider>
        </BrowserRouter>
      </AuthProvider>
    </ToastProvider>
  )
}
