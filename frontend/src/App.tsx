import { BrowserRouter, Routes, Route, NavLink, Navigate, useLocation } from 'react-router-dom'
import { AuthProvider, useAuth } from './lib/auth'
import { CentreProvider, useCentres } from './lib/centres'
import { BrandProvider, useBrand } from './lib/brand'
import { ToastProvider } from './components/Toast'
import { LoadingPanel } from './components/ui'
import { CreativeIqLogo, MascotCrew, RoboThinkLogo } from './components/Branding'
import BrandSwitcher from './components/BrandSwitcher'
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

/** Rotates the four brand colours through the nav dots — decoration only. */
const DOT_COLOURS = ['var(--rt-yellow)', 'var(--rt-green)', 'var(--rt-blue)', 'var(--rt-red)']

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
  const { activeBrand } = useBrand()
  const { pathname } = useLocation()
  const { activeCentres, assignedCentres, selectedCentreId, selectedCentre, isAllCentres, loading: centresLoading, error: centresError, setSelectedCentreId } = useCentres()
  const items = NAV.filter((item) => !role || item.roles.includes(role))
  return (
    <div data-brand={activeBrand} className="min-h-screen bg-[color:var(--rt-paper)] text-[color:var(--rt-ink)]">
      <a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 btn-primary">
        Skip to content
      </a>
      <div className="brand-stripe" aria-hidden />
      <div className="max-w-7xl mx-auto px-3 sm:px-4 py-3 sm:py-4 lg:py-6 grid grid-cols-1 lg:grid-cols-5 gap-4 sm:gap-6">
        <aside className="lg:col-span-1 min-w-0">
          <div className="card p-4 lg:sticky lg:top-6">
            <div className="flex items-center gap-3 mb-4">
              {activeBrand === 'creative_iq' ? <CreativeIqLogo className="w-40 max-w-full" /> : <RoboThinkLogo className="w-40 max-w-full" />}
            </div>
            <p className="text-[11px] text-slate-500 -mt-2 mb-3">Register &amp; Progress</p>
            <BrandSwitcher />
            {activeBrand === 'robothink' && <MascotCrew className="mb-4 pb-3 border-b border-slate-100" />}
            <nav className="flex lg:flex-col gap-1.5 overflow-x-auto overscroll-x-contain -mx-1 px-1 pb-1" aria-label="Main navigation">
              {items.map((item, index) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className="nav-link"
                >
                  <span className="nav-dot" style={{ '--dot': DOT_COLOURS[index % DOT_COLOURS.length] } as React.CSSProperties} aria-hidden />
                  {item.label}
                </NavLink>
              ))}
            </nav>
            <div className="mt-4 pt-3 border-t border-slate-100">
              <div className="hidden lg:block text-sm font-medium truncate">{profile?.name ?? 'Signed in'}</div>
              <div className="hidden lg:block text-xs text-slate-500 capitalize mb-2">{profile?.role ?? 'staff'}</div>
              {!centresLoading && !centresError && (activeCentres.length > 0 || assignedCentres.length > 0) && (
                <label className="block mb-2">
                  <span className="text-xs text-slate-500">Working centre</span>
                  <select
                    className="mt-1 w-full p-1.5 border border-slate-200 rounded-lg text-xs"
                    value={isAllCentres ? '' : selectedCentreId ?? ''}
                    onChange={(event) => setSelectedCentreId(event.target.value || null)}
                    aria-label="Working centre"
                  >
                    {role === 'admin' && <option value="">All centres</option>}
                    {(role === 'admin' ? activeCentres : assignedCentres.filter((centre) => centre.active)).map((centre) => (
                      <option key={centre.id} value={centre.id}>{centre.name}</option>
                    ))}
                  </select>
                  {selectedCentre && <span className="sr-only">Selected centre: {selectedCentre.name}</span>}
                </label>
              )}
              <button onClick={() => void signOut()} className="btn-ghost w-full text-sm hidden lg:block">Sign out</button>
            </div>
          </div>
          <button onClick={() => void signOut()} className="btn-ghost w-full mt-3 lg:hidden text-sm">
            Sign out{profile ? ` (${profile.name})` : ''}
          </button>
        </aside>

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
