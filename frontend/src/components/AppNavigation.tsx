import { useRef, useState } from 'react'
import { NavLink } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { useBrand } from '../lib/brand'
import { useCentres } from '../lib/centres'
import { CreativeIqLogo, MascotCrew, RoboThinkLogo } from './Branding'
import BrandSwitcher from './BrandSwitcher'

const DOT_COLOURS = ['var(--rt-yellow)', 'var(--rt-green)', 'var(--rt-blue)', 'var(--rt-red)']

export default function AppNavigation({ items }: { items: { to: string; label: string; end?: boolean }[] }) {
  const { profile, role, signOut } = useAuth()
  const { activeBrand } = useBrand()
  const { activeCentres, assignedCentres, selectedCentreId, selectedCentre, isAllCentres, loading, error, setSelectedCentreId } = useCentres()
  const [menuOpen, setMenuOpen] = useState(false)
  const menuButton = useRef<HTMLButtonElement>(null)

  function closeMenu() { setMenuOpen(false) }

  return (
    <aside className="lg:col-span-1 min-w-0" aria-label="Application navigation">
      <div className="card p-3 lg:p-4 lg:sticky lg:top-6" onKeyDown={(event) => {
        if (event.key === 'Escape' && menuOpen) {
          closeMenu()
          menuButton.current?.focus()
        }
      }}>
        <div className="flex items-center justify-between gap-3 lg:mb-4">
          {activeBrand === 'creative_iq' ? <CreativeIqLogo className="w-28 lg:w-40 max-w-full" /> : <RoboThinkLogo className="w-28 lg:w-40 max-w-full" />}
          <button ref={menuButton} type="button" className="btn-ghost lg:hidden" aria-expanded={menuOpen} aria-controls="application-menu" onClick={() => setMenuOpen((open) => !open)}>
            {menuOpen ? 'Close menu' : 'Menu'}
          </button>
        </div>
        <p className="hidden lg:block text-xs text-slate-600 -mt-2 mb-3">Register &amp; Progress</p>

        {/* Centre context stays visible even when the mobile menu is closed. */}
        {!loading && !error && (activeCentres.length > 0 || assignedCentres.length > 0) && (
          <label className="block mt-2 mb-0 lg:mt-0 lg:mb-4">
            <span className="text-xs font-medium text-slate-600">Working centre</span>
            <select className="mt-1 w-full p-2 border border-slate-200 rounded-lg text-sm" value={isAllCentres ? '' : selectedCentreId ?? ''} onChange={(event) => setSelectedCentreId(event.target.value || null)} aria-label="Working centre">
              {role === 'admin' && <option value="">All centres</option>}
              {(role === 'admin' ? activeCentres : assignedCentres.filter((centre) => centre.active)).map((centre) => <option key={centre.id} value={centre.id}>{centre.name}</option>)}
            </select>
            {selectedCentre && <span className="sr-only">Selected centre: {selectedCentre.name}</span>}
          </label>
        )}

        <div id="application-menu" className={menuOpen ? 'mt-3 lg:mt-0' : 'hidden lg:block'}>
          <BrandSwitcher />
          {activeBrand === 'robothink' && <MascotCrew className="hidden lg:block mb-4 pb-3 border-b border-slate-100" />}
          <nav className="flex flex-col gap-1.5" aria-label="Main navigation">
            {items.map((item, index) => (
              <NavLink key={item.to} to={item.to} end={item.end} onClick={closeMenu} className="nav-link">
                <span className="nav-dot" style={{ '--dot': DOT_COLOURS[index % DOT_COLOURS.length] } as React.CSSProperties} aria-hidden />
                {item.label}
              </NavLink>
            ))}
          </nav>
          <div className="mt-4 pt-3 border-t border-slate-100">
            <div className="text-sm font-medium break-words">{profile?.name ?? 'Signed in'}</div>
            <div className="text-xs text-slate-600 capitalize mb-2">{profile?.role ?? 'staff'}</div>
            <button onClick={() => void signOut()} className="btn-ghost w-full text-sm">Sign out</button>
          </div>
        </div>
      </div>
    </aside>
  )
}
