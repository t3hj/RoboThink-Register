// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Auth from '../src/pages/Auth'

const backend = vi.hoisted(() => ({ enabled: true, oauth: vi.fn(), email: vi.fn() }))
vi.mock('../src/lib/supabaseClient', () => ({
  supabaseConfigured: true,
  googleSignInEnabled: async () => backend.enabled,
  supabase: { auth: { signInWithOAuth: backend.oauth, signInWithOtp: backend.email } },
}))
vi.mock('../src/components/Branding', () => ({ MascotCrew: () => null, RoboThinkLogo: () => null }))
let root: Root
beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  window.history.replaceState(null, '', '/')
  backend.enabled = true
  backend.oauth.mockReset().mockResolvedValue({ error: null })
  backend.email.mockReset().mockResolvedValue({ error: null })
  document.body.innerHTML = '<div id="root"></div>'
  root = createRoot(document.querySelector('#root')!)
})
afterEach(async () => { await act(async () => root.unmount()) })
async function mount() { await act(async () => root.render(<Auth />)) }
const google = () => [...document.querySelectorAll('button')].find((button) => button.textContent?.includes('Google'))!

describe('staff login methods', () => {
  it('offers Google only when the backend provider is enabled', async () => {
    backend.enabled = false
    await mount()
    expect(google()).toBeUndefined()
    expect(document.querySelector('form')).not.toBeNull()
  })
  it('starts Google with the correct origin and lets staff choose their account', async () => {
    await mount()
    await act(async () => google().click())
    expect(backend.oauth).toHaveBeenCalledWith({ provider: 'google', options: {
      redirectTo: window.location.origin, queryParams: { prompt: 'select_account' },
    } })
    expect(backend.email).not.toHaveBeenCalled()
  })
  it('recovers from OAuth network errors without losing the email fallback', async () => {
    backend.oauth.mockRejectedValue(new Error('offline'))
    await mount()
    await act(async () => google().click())
    expect(document.querySelector('[role="alert"]')?.textContent).toMatch(/could not be started/)
    expect(google().disabled).toBe(false)
    expect(document.querySelector('button[type="submit"]')?.hasAttribute('disabled')).toBe(false)
  })
  it('handles callback cancellation and clears error parameters without showing URL text', async () => {
    window.history.replaceState(null, '', '/?error=access_denied&error_description=untrusted&keep=1')
    await mount()
    expect(document.querySelector('[role="alert"]')?.textContent).toMatch(/cancelled/)
    expect(document.body.textContent).not.toContain('untrusted')
    expect(window.location.search).toBe('?keep=1')
  })
  it('keeps email sign-in working and clears the pending state on failure', async () => {
    backend.email.mockRejectedValue(new Error('offline'))
    await mount()
    const input = document.querySelector('input')!
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    await act(async () => {
      setValue.call(input, 'staff@example.com')
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await act(async () => document.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
    expect(backend.email).toHaveBeenCalledWith({ email: 'staff@example.com', options: { emailRedirectTo: window.location.origin } })
    expect(document.querySelector('[role="alert"]')?.textContent).toMatch(/could not be sent/)
    expect(document.querySelector('button[type="submit"]')?.hasAttribute('disabled')).toBe(false)
  })
})
