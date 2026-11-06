import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Session, SupabaseClient } from '@supabase/supabase-js'
import { startSessionRecovery, type SessionState } from '../src/lib/sessionRecovery'
const saved = { user: { id: 'staff' }, access_token: 'test', refresh_token: 'test' } as Session
const flush = async () => { await Promise.resolve(); await Promise.resolve() }
function setup() {
  let event: (name: string, session: Session | null) => void = () => {}
  const getSession = vi.fn().mockResolvedValue({ data: { session: saved }, error: null })
  const unsubscribe = vi.fn()
  const auth = { getSession, onAuthStateChange: (callback: typeof event) => {
    event = callback; return { data: { subscription: { unsubscribe } } }
  } } as unknown as SupabaseClient['auth']
  const states: SessionState[] = []
  return { getSession, unsubscribe, states, emit: (name: string, session: Session | null) => event(name, session),
    start: () => startSessionRecovery(auth, state => states.push(state)) }
}
afterEach(() => vi.useRealTimers())
describe('saved session recovery', () => {
  it('restores a saved session on reopening', async () => {
    const t = setup(); const c = t.start(); await flush()
    expect(t.states.at(-1)).toEqual({ session: saved, loading: false, error: null }); c.dispose()
  })
  it('retries refresh errors even after INITIAL_SESSION(null)', async () => {
    vi.useFakeTimers(); const t = setup()
    t.getSession.mockResolvedValueOnce({ data: { session: null }, error: new Error('Offline') })
    const c = t.start(); t.emit('INITIAL_SESSION', null); await flush()
    expect(t.states.at(-1)?.error).toBeTruthy()
    await vi.advanceTimersByTimeAsync(2000)
    expect(t.states.at(-1)?.session).toBe(saved); c.dispose()
  })
  it('retains an open session during network errors and recovers on retry', async () => {
    const t = setup(); const c = t.start(); await flush()
    t.getSession.mockRejectedValueOnce(new Error('Offline')); c.retry(); await flush()
    expect(t.states.at(-1)?.session).toBe(saved)
    expect(t.states.at(-1)?.error).toBeTruthy()
    c.retry(); await flush(); expect(t.states.at(-1)?.error).toBeNull(); c.dispose()
  })
  it('accepts a successful check confirming no saved session', async () => {
    const t = setup(); t.getSession.mockResolvedValue({ data: { session: null }, error: null })
    const c = t.start(); await flush()
    expect(t.states.at(-1)).toEqual({ session: null, loading: false, error: null }); c.dispose()
  })
  it.each(['SIGNED_OUT', 'SIGNED_IN'])('ignores stale results after %s', async event => {
    const t = setup(); let resolve!: (value: unknown) => void
    t.getSession.mockReturnValue(new Promise(done => { resolve = done }))
    const c = t.start(); const next = event === 'SIGNED_OUT' ? null : saved
    t.emit(event, next)
    resolve({ data: { session: next ? null : saved }, error: null }); await flush()
    expect(t.states.at(-1)?.session).toBe(next); c.dispose()
  })
  it('coalesces simultaneous wake events', () => {
    const t = setup(); t.getSession.mockReturnValue(new Promise(() => {}))
    const c = t.start(); c.retry(); c.retry()
    expect(t.getSession).toHaveBeenCalledTimes(1); c.dispose()
  })
  it('bounds automatic retries and cleans up on unmount', async () => {
    vi.useFakeTimers(); const t = setup(); t.getSession.mockRejectedValue(new Error('Offline'))
    const c = t.start(); await flush(); await vi.advanceTimersByTimeAsync(30000)
    expect(t.getSession).toHaveBeenCalledTimes(4)
    c.retry(); await flush(); c.dispose(); await vi.advanceTimersByTimeAsync(30000)
    expect(t.getSession).toHaveBeenCalledTimes(5)
    expect(t.unsubscribe).toHaveBeenCalledOnce()
  })
})
