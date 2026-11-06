import React, { createContext, useContext, useEffect, useRef, useState } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { supabase } from '../lib/supabaseClient'
import type { Profile, Role } from '../types'
import { startSessionRecovery } from './sessionRecovery'

interface AuthContextValue {
  session: Session | null
  user: User | null
  profile: Profile | null
  role: Role | null
  loading: boolean
  sessionError: string | null
  retrySession: () => void
  profileError: string | null
  retryProfile: () => void
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue>({
  session: null,
  user: null,
  profile: null,
  role: null,
  loading: true,
  sessionError: null,
  retrySession: () => {},
  profileError: null,
  retryProfile: () => {},
  signOut: async () => { },
})

export function useAuth() {
  return useContext(AuthContext)
}

/**
 * Owns the Supabase session and the linked public.profiles row.
 * profiles.auth_id is matched to auth.users.id (see db/robothink_rls.sql).
 */
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profileState, setProfileState] = useState<{ userId: string | null; profile: Profile | null; loading: boolean; error: string | null }>({ userId: null, profile: null, loading: false, error: null })
  const [profileAttempt, setProfileAttempt] = useState(0)
  const userId = session?.user.id ?? null
  const profile = profileState.userId === userId ? profileState.profile : null
  const profileLoading = !!userId && (profileState.userId !== userId || profileState.loading)
  const [loading, setLoading] = useState(true)

  const [sessionError, setSessionError] = useState<string | null>(null)
  const recovery = useRef<ReturnType<typeof startSessionRecovery> | null>(null)
  const retrySession = () => recovery.current?.retry()

  useEffect(() => {
    const controller = startSessionRecovery(supabase.auth, (state) => {
      setSession(state.session)
      setSessionError(state.error)
      setLoading(state.loading)
    })
    recovery.current = controller
    const resume = () => {
      if (document.visibilityState !== 'hidden') controller.retry()
    }
    window.addEventListener('online', resume)
    window.addEventListener('pageshow', resume)
    window.addEventListener('focus', resume)
    document.addEventListener('visibilitychange', resume)
    return () => {
      recovery.current = null
      controller.dispose()
      window.removeEventListener('online', resume)
      window.removeEventListener('pageshow', resume)
      window.removeEventListener('focus', resume)
      document.removeEventListener('visibilitychange', resume)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    if (!userId) {
      setProfileState({ userId: null, profile: null, loading: false, error: null })
      return
    }
    setProfileState({ userId, profile: null, loading: true, error: null })
    async function loadProfile() {
      try {
        const { data, error } = await supabase.from('profiles').select('*').eq('auth_id', userId).maybeSingle()
        if (cancelled) return
        setProfileState({ userId, profile: error ? null : data, loading: false, error: error ? 'Your staff access could not be loaded. Please try again.' : null })
      } catch {
        if (!cancelled) setProfileState({ userId, profile: null, loading: false, error: 'Your staff access could not be loaded. Check your connection and try again.' })
      }
    }
    void loadProfile()
    return () => { cancelled = true }
  }, [userId, profileAttempt])

  const retryProfile = () => {
    setProfileState({ userId, profile: null, loading: true, error: null })
    setProfileAttempt((attempt) => attempt + 1)
  }

  const signOut = async () => {
    const { error } = await supabase.auth.signOut({ scope: 'local' })
    if (error) {
      setSessionError('Sign-out could not be completed. Check your connection and try again.')
      return
    }
    setProfileState({ userId: null, profile: null, loading: false, error: null })
  }

  return (
    <AuthContext.Provider
      value={{
        session,
        user: session?.user ?? null,
        profile,
        role: profile?.role ?? null,
        loading: loading || profileLoading,
        sessionError,
        retrySession,
        profileError: profileState.userId === userId ? profileState.error : null,
        retryProfile,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}
