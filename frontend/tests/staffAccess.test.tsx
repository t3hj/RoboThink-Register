import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthProvider, useAuth } from '../src/lib/auth'

const backend = vi.hoisted(() => ({
  changed: null as null | ((_event: string, session: unknown) => void),
  results: [] as Promise<unknown>[],
}))
vi.mock('../src/lib/supabaseClient', () => ({ supabase: {
  auth: {
    getSession: async () => ({ data: { session: { user: { id: 'staff-a' } } } }),
    onAuthStateChange: (callback: typeof backend.changed) => { backend.changed = callback; return { data: { subscription: { unsubscribe() {} } } } },
    signOut: async () => { backend.changed?.('SIGNED_OUT', null) },
  },
  from: () => ({ select: () => ({ eq: () => ({ maybeSingle: () => backend.results.shift() ?? Promise.resolve({ data: null, error: null }) }) }) }),
} }))
let state: ReturnType<typeof useAuth>
function Consumer() { state = useAuth(); return <span>{state.loading ? 'Checking access' : state.role ?? 'No staff access'}</span> }
let renderer: ReactTestRenderer
async function mount() { await act(async () => { renderer = create(<AuthProvider><Consumer /></AuthProvider>) }) }
function deferred() { let resolve!: (value: unknown) => void; const promise = new Promise((done) => { resolve = done }); return { promise, resolve } }
beforeEach(() => { backend.changed = null; backend.results = [] })
afterEach(async () => { if (renderer) await act(async () => renderer.unmount()) })

describe('staff profile access', () => {
  it('keeps access loading until the linked profile resolves', async () => {
    const request = deferred(); backend.results.push(request.promise)
    await mount()
    expect(state.loading).toBe(true)
    expect(state.role).toBeNull()
    await act(async () => request.resolve({ data: { id: 'profile-a', role: 'instructor' }, error: null }))
    expect(state.loading).toBe(false)
    expect(state.role).toBe('instructor')
  })
  it('distinguishes an unlinked account from a failed query and can retry', async () => {
    backend.results.push(Promise.resolve({ data: null, error: { message: 'Network error' } }))
    await mount()
    expect(state.profileError).toMatch(/could not be loaded/)
    expect(state.role).toBeNull()
    backend.results.push(Promise.resolve({ data: null, error: null }))
    await act(async () => state.retryProfile())
    expect(state.loading).toBe(false)
    expect(state.profileError).toBeNull()
    expect(state.profile).toBeNull()
    backend.results.push(Promise.resolve({ data: { id: 'profile-a', role: 'management' }, error: null }))
    await act(async () => state.retryProfile())
    expect(state.role).toBe('management')
  })
  it('clears the old role immediately when the signed-in user changes', async () => {
    backend.results.push(Promise.resolve({ data: { id: 'profile-a', role: 'admin' }, error: null }))
    await mount()
    const request = deferred(); backend.results.push(request.promise)
    await act(async () => backend.changed?.('SIGNED_IN', { user: { id: 'staff-b' } }))
    expect(state.role).toBeNull()
    expect(state.loading).toBe(true)
    await act(async () => request.resolve({ data: { id: 'profile-b', role: 'instructor' }, error: null }))
    expect(state.role).toBe('instructor')
  })
  it('ignores late profile responses after signing out', async () => {
    const request = deferred(); backend.results.push(request.promise)
    await mount()
    await act(async () => backend.changed?.('SIGNED_OUT', null))
    await act(async () => request.resolve({ data: { id: 'profile-a', role: 'admin' }, error: null }))
    expect(state.user).toBeNull()
    expect(state.profile).toBeNull()
    expect(state.role).toBeNull()
  })
})
