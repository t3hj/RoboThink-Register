import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useToast } from '../components/Toast'
import { PageHeader, LoadingPanel, ErrorPanel, EmptyState } from '../components/ui'
import type { Profile, Role } from '../types'

const ROLES: Role[] = ['admin', 'instructor', 'management']

/** Minimal, admin-only: list staff and change their role. Nothing fancier
 *  than that is asked for — inviting/creating accounts still happens via
 *  Supabase Auth directly; this just lets an admin correct/assign a role
 *  once an account exists (handle_new_user already defaults new sign-ups
 *  to 'instructor', never 'admin'). */
export default function StaffManagement() {
  const { notify } = useToast()
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [savingId, setSavingId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const { data, error: err } = await supabase.from('profiles').select('*').order('name')
    if (err) {
      setError(err.message)
      setLoading(false)
      return
    }
    setProfiles((data ?? []) as Profile[])
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function changeRole(id: string, role: Role) {
    setSavingId(id)
    const { error: err } = await supabase.from('profiles').update({ role }).eq('id', id)
    setSavingId(null)
    if (err) {
      notify(err.message, 'error')
      return
    }
    notify('Role updated', 'success')
    void load()
  }

  if (loading) return <LoadingPanel label="Loading staff…" />
  if (error) return <ErrorPanel message={error} onRetry={() => void load()} />

  return (
    <div>
      <PageHeader title="Staff" subtitle="Assign roles for staff accounts" accent="red" />
      {profiles.length === 0 ? (
        <EmptyState title="No staff profiles found" />
      ) : (
        <div className="card divide-y divide-slate-100">
          {profiles.map((p) => (
            <div key={p.id} className="p-3 flex items-center justify-between gap-3 flex-wrap">
              <div>
                <div className="font-medium text-sm">{p.name}</div>
                <div className="text-xs text-slate-500">
                  {p.email ?? '—'}{!p.auth_id && <span className="ml-1.5">(no login — historical/seed record)</span>}
                </div>
              </div>
              <select
                className="p-1.5 border border-slate-200 rounded-lg text-sm"
                value={p.role}
                disabled={savingId === p.id}
                onChange={(e) => void changeRole(p.id, e.target.value as Role)}
                aria-label={`Role for ${p.name}`}
              >
                {ROLES.map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
