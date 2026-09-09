import React, { createContext, useContext, useEffect, useState } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { supabase } from '../lib/supabaseClient'
import type { Profile, Role } from '../types'

interface AuthContextValue {
  session: Session | null
  user: User | null
  profile: Profile | null
  role: Role | null
  loading: boolean
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue>({
  session: null,
  user: null,
  profile: null,
  role: null,
  loading: true,
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
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setLoading(false)
    })
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s)
      setLoading(false)
    })
    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => {
    let cancelled = false
    async function loadProfile(user: User | null) {
      if (!user) {
        setProfile(null)
        return
      }
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('auth_id', user.id)
        .maybeSingle()
      if (cancelled) return
      if (error) {
        console.error('Failed to load profile:', error.message)
        setProfile(null)
      } else {
        setProfile(data)
      }
    }
    loadProfile(session?.user ?? null)
    return () => {
      cancelled = true
    }
  }, [session?.user?.id])

  const signOut = async () => {
    await supabase.auth.signOut()
    setProfile(null)
  }

  return (
    <AuthContext.Provider
      value={{
        session,
        user: session?.user ?? null,
        profile,
        role: profile?.role ?? null,
        loading,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}
