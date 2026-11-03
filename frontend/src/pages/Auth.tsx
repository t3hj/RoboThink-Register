import { useEffect, useState } from 'react'
import { googleSignInEnabled, supabase, supabaseConfigured } from '../lib/supabaseClient'
import { MascotCrew, RoboThinkLogo } from '../components/Branding'

export default function Auth() {
  const [email, setEmail] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState(false)
  const [sending, setSending] = useState(false)
  const [googleEnabled, setGoogleEnabled] = useState(false)
  const [openingGoogle, setOpeningGoogle] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    void googleSignInEnabled(controller.signal).then((enabled) => {
      if (!controller.signal.aborted) setGoogleEnabled(enabled)
    })
    const query = new URLSearchParams(window.location.search)
    const hash = new URLSearchParams(window.location.hash.slice(1))
    if (query.has('error') || hash.has('error')) {
      setError(true)
      setMessage('Sign-in was cancelled or could not be completed. Please try again or use an email link.')
      // Remove only OAuth error fields; never display provider text from a URL.
      const clean = new URL(window.location.href)
      for (const key of ['error', 'error_code', 'error_description']) {
        clean.searchParams.delete(key)
        hash.delete(key)
      }
      clean.hash = hash.toString()
      window.history.replaceState(null, '', clean)
    }
    return () => controller.abort()
  }, [])

  const signInWithGoogle = async () => {
    setOpeningGoogle(true)
    setMessage('')
    try {
      const { error: err } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: window.location.origin,
          queryParams: { prompt: 'select_account' },
        },
      })
      if (err) throw err
    } catch {
      setError(true)
      setMessage('Google sign-in could not be started. Please try again or use an email link.')
    } finally {
      setOpeningGoogle(false)
    }
  }

  const signIn = async (e: React.FormEvent) => {
    e.preventDefault()
    const addr = email.trim()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr)) {
      setError(true)
      setMessage('Please enter a valid email address.')
      return
    }
    setSending(true)
    setMessage('')
    try {
      const { error: err } = await supabase.auth.signInWithOtp({
        email: addr,
        options: { emailRedirectTo: window.location.origin },
      })
      if (err) throw err
      setError(false)
      setMessage(`Sign-in link sent to ${addr}. Check your inbox (and spam folder).`)
    } catch {
      setError(true)
      setMessage('The sign-in link could not be sent. Check your connection and try again.')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="min-h-screen bg-[color:var(--rt-paper)] text-[color:var(--rt-ink)] flex items-center justify-center p-6">
      <div className="card overflow-hidden max-w-md w-full">
        <div className="brand-stripe" aria-hidden />
        <div className="p-6 sm:p-8">
          <div className="mb-5">
            <RoboThinkLogo className="w-52 max-w-full" />
            <h1 className="text-xl font-semibold mt-3">Register &amp; Progress</h1>
            <p className="text-sm text-slate-600">Staff sign-in</p>
          </div>
          <MascotCrew className="mb-6 rounded-xl bg-slate-50 p-3" />
          {!supabaseConfigured && (
            <div className="mb-4 rounded-lg bg-amber-50 border border-amber-200 p-3 text-sm text-amber-800">
              Sign-in is temporarily unavailable. Please contact your administrator for help.
            </div>
          )}
          {googleEnabled && (
            <div className="mb-5">
              <button type="button" className="btn-ghost w-full min-h-11 border border-slate-300" disabled={openingGoogle || sending || !supabaseConfigured} onClick={() => void signInWithGoogle()}>
                {openingGoogle ? 'Opening Google…' : 'Continue with Google'}
              </button>
              <p className="text-xs text-slate-600 mt-2">Choose the Google account with your approved staff email.</p>
              <p className="text-sm text-slate-600 text-center mt-4">or use an email link</p>
            </div>
          )}
          <form onSubmit={signIn} className="space-y-3">
            <label className="block">
              <span className="text-sm font-medium text-slate-700">Staff email</span>
              <input
                type="email"
                required
                autoComplete="email"
                aria-describedby="sign-in-help"
                className="mt-1 w-full p-2.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[color:var(--rt-primary)]/40"
                placeholder="you@robothink.co.uk"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
            <p id="sign-in-help" className="text-sm text-slate-600">Use your staff email. We’ll send you a secure sign-in link; no password is needed.</p>
            <button type="submit" disabled={sending || openingGoogle || !supabaseConfigured} className="btn-primary w-full">
              {sending ? 'Sending…' : 'Send sign-in link'}
            </button>
          </form>
          {message && (
            <p className={`mt-4 text-sm ${error ? 'text-rose-600' : 'text-emerald-700'}`} role="alert">
              {message}
            </p>
          )}
          <p className="mt-5 text-xs text-slate-600">On your own phone, your session is remembered when browser storage is available. Always sign out on shared centre devices.</p>
          <p className="mt-3 text-xs text-slate-600">
            Access is restricted to authorised staff. If you need access or cannot sign in, please contact your administrator.
          </p>
        </div>
      </div>
    </div>
  )
}
