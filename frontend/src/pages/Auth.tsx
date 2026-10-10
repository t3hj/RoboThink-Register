import { useState } from 'react'
import { supabase, supabaseConfigured } from '../lib/supabaseClient'
import { MascotCrew, RoboThinkLogo } from '../components/Branding'

export default function Auth() {
  const [email, setEmail] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState(false)
  const [sending, setSending] = useState(false)

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
    const { error: err } = await supabase.auth.signInWithOtp({
      email: addr,
      options: { emailRedirectTo: window.location.origin },
    })
    setSending(false)
    if (err) {
      setError(true)
      setMessage(err.message)
    } else {
      setError(false)
      setMessage(`Sign-in link sent to ${addr}. Check your inbox (and spam folder).`)
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
            <p className="text-sm text-slate-500">Staff sign-in</p>
          </div>
          <MascotCrew className="mb-6 rounded-xl bg-slate-50 p-3" />
          {!supabaseConfigured && (
            <div className="mb-4 rounded-lg bg-amber-50 border border-amber-200 p-3 text-sm text-amber-800">
              Supabase is not configured. Copy <code>frontend/.env.example</code> to{' '}
              <code>frontend/.env</code> and set <code>VITE_SUPABASE_URL</code> and{' '}
              <code>VITE_SUPABASE_ANON_KEY</code>, then restart the dev server.
            </div>
          )}
          <form onSubmit={signIn} className="space-y-3">
            <label className="block">
              <span className="text-sm font-medium text-slate-700">Instructor email</span>
              <input
                type="email"
                required
                autoComplete="email"
                className="mt-1 w-full p-2.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[color:var(--rt-primary)]/40"
                placeholder="you@robothink.co.uk"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
            <button type="submit" disabled={sending} className="btn-primary w-full">
              {sending ? 'Sending…' : 'Send sign-in link'}
            </button>
          </form>
          {message && (
            <p className={`mt-4 text-sm ${error ? 'text-rose-600' : 'text-emerald-700'}`} role="alert">
              {message}
            </p>
          )}
          <p className="mt-6 text-xs text-slate-400">
            Access is restricted to RoboThink staff. Accounts must be mapped to a staff profile
            (see <code>db/robothink_rls.sql</code>).
          </p>
        </div>
      </div>
    </div>
  )
}
