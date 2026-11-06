import type { Session, SupabaseClient } from '@supabase/supabase-js'

type Auth = Pick<SupabaseClient['auth'], 'getSession' | 'onAuthStateChange'>
export interface SessionState {
  session: Session | null
  loading: boolean
  error: string | null
}

/** Keep network/storage failures distinct from a confirmed missing session.
 * Supabase owns token storage, refresh locks and rotation; never copy tokens. */
export function startSessionRecovery(auth: Auth, publish: (state: SessionState) => void) {
  let active = true
  let generation = 0
  let inFlight = false
  let session: Session | null = null
  let retryCount = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  const delays = [2000, 5000, 15000]
  const clearRetry = () => { clearTimeout(timer); timer = undefined }

  const recover = async () => {
    if (!active || inFlight) return
    clearRetry()
    inFlight = true
    const startedAt = generation
    // Do not unmount the register or login form on focus: preserve drafts
    // and typed email addresses while checking in the background.
    try {
      const { data, error } = await auth.getSession()
      if (!active || startedAt !== generation) return
      if (error) throw error
      session = data.session
      retryCount = 0
      publish({ session, loading: false, error: null })
    } catch {
      if (!active || startedAt !== generation) return
      publish({ session, loading: false, error: 'Your saved sign-in could not be checked. Check your connection and try again.' })
      if (retryCount < delays.length) timer = setTimeout(() => void recover(), delays[retryCount++])
    } finally {
      inFlight = false
    }
  }

  const { data: { subscription } } = auth.onAuthStateChange((event, next) => {
    if (!active) return
    // INITIAL_SESSION(null) can follow failed network recovery. Only a
    // successful getSession or explicit SIGNED_OUT confirms a missing login.
    if (!next && event !== 'SIGNED_OUT') return
    generation++
    clearRetry()
    retryCount = 0
    session = next
    publish({ session, loading: false, error: null })
  })
  void recover()

  return {
    retry: () => { retryCount = 0; void recover() },
    dispose: () => { active = false; generation++; clearRetry(); subscription.unsubscribe() },
  }
}
