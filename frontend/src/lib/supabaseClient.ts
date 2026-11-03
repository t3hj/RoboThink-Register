import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

if (!url || !anonKey) {
  // Fail loudly but keep the app mountable so the UI can explain the problem.
  console.error(
    'VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are not set. ' +
      'Copy frontend/.env.example to frontend/.env and fill in your Supabase project details.',
  )
}

export const supabaseConfigured = Boolean(url && anonKey)

export const supabase = createClient(
  url || 'https://placeholder.supabase.co',
  anonKey || 'public-anon-key-placeholder',
  { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } },
)

/** Public Auth settings: never show a provider that has not been enabled. */
export async function googleSignInEnabled(signal?: AbortSignal): Promise<boolean> {
  if (!url || !anonKey) return false
  try {
    const response = await fetch(`${url.replace(/\/$/, '')}/auth/v1/settings`, {
      headers: { apikey: anonKey }, signal,
    })
    if (!response.ok) return false
    const settings = await response.json()
    return settings.external?.google === true
  } catch {
    return false
  }
}
