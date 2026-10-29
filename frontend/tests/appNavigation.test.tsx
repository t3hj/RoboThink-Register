import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import AppNavigation from '../src/components/AppNavigation'
const changeCentre = vi.fn()
vi.mock('../src/lib/auth', () => ({ useAuth: () => ({ role: 'instructor', profile: { name: 'Test Staff', role: 'instructor' }, signOut: vi.fn() }) }))
vi.mock('../src/lib/brand', () => ({ useBrand: () => ({ activeBrand: 'robothink', setActiveBrand: vi.fn() }) }))
vi.mock('../src/lib/centres', () => ({ useCentres: () => ({ activeCentres: [], assignedCentres: [{ id: 'a', name: 'Centre A', active: true }, { id: 'b', name: 'Centre B', active: true }], selectedCentreId: 'a', selectedCentre: { name: 'Centre A' }, loading: false, error: null, setSelectedCentreId: changeCentre }) }))
let renderer: ReactTestRenderer
afterEach(async () => { if (renderer) await act(async () => renderer.unmount()) })
describe('compact navigation', () => {
  it('keeps the centre selector outside the collapsed menu and closes after navigation', async () => {
    await act(async () => { renderer = create(<MemoryRouter><AppNavigation items={[{ to: '/register', label: 'Register' }]} /></MemoryRouter>) })
    const menu = () => renderer.root.findByProps({ id: 'application-menu' })
    const toggle = () => renderer.root.findByProps({ 'aria-controls': 'application-menu' })
    expect(toggle().props['aria-expanded']).toBe(false)
    expect(menu().props.className).toBe('hidden lg:block')
    const centre = renderer.root.findByProps({ 'aria-label': 'Working centre' })
    expect(centre.parent?.parent?.props.id).not.toBe('application-menu')
    await act(async () => centre.props.onChange({ target: { value: 'b' } }))
    expect(changeCentre).toHaveBeenCalledWith('b')
    await act(async () => toggle().props.onClick())
    expect(toggle().props['aria-expanded']).toBe(true)
    await act(async () => renderer.root.findByType('a').props.onClick({ button: 0, preventDefault() {}, metaKey: false, altKey: false, ctrlKey: false, shiftKey: false, defaultPrevented: false }))
    expect(toggle().props['aria-expanded']).toBe(false)
  })
})
