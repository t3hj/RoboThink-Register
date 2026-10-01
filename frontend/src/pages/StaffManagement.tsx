import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useToast } from '../components/Toast'
import { PageHeader, LoadingPanel, ErrorPanel, EmptyState } from '../components/ui'
import type { Centre, Profile, Role, StaffCentre } from '../types'

const ROLES: Role[] = ['admin', 'instructor', 'management']

/** Minimal, admin-only: list staff and change their role. Nothing fancier
 *  than that is asked for — inviting/creating accounts still happens via
 *  Supabase Auth directly; this just lets an admin correct/assign a role
 *  once an account exists (handle_new_user already defaults new sign-ups
 *  to 'instructor', never 'admin'). */
export default function StaffManagement() {
  const { notify } = useToast()
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [centres, setCentres] = useState<Centre[]>([])
  const [assignments, setAssignments] = useState<StaffCentre[]>([])
  const [newCentreName, setNewCentreName] = useState('')
  const [assignmentStaffId, setAssignmentStaffId] = useState('')
  const [assignmentCentreId, setAssignmentCentreId] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [savingId, setSavingId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const [profilesRes, centresRes, assignmentsRes] = await Promise.all([
      supabase.from('profiles').select('*').order('name'),
      supabase.from('centres').select('*').order('name'),
      supabase.from('staff_centres').select('staff_id, centre_id, created_at'),
    ])
    if (profilesRes.error || centresRes.error || assignmentsRes.error) {
      setError(profilesRes.error?.message ?? centresRes.error?.message ?? assignmentsRes.error?.message ?? 'Unable to load staff management')
      setLoading(false)
      return
    }
    setProfiles((profilesRes.data ?? []) as Profile[])
    setCentres((centresRes.data ?? []) as Centre[])
    setAssignments((assignmentsRes.data ?? []) as StaffCentre[])
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

  async function addCentre() {
    const name = newCentreName.trim()
    if (!name) return
    setSavingId('new-centre')
    const { error: err } = await supabase.from('centres').insert({ name, active: true })
    setSavingId(null)
    if (err) {
      notify(err.message, 'error')
      return
    }
    setNewCentreName('')
    notify('Centre added', 'success')
    void load()
  }

  async function toggleCentre(centre: Centre) {
    setSavingId(centre.id)
    const { error: err } = await supabase.from('centres').update({ active: !centre.active }).eq('id', centre.id)
    setSavingId(null)
    if (err) {
      notify(err.message, 'error')
      return
    }
    notify(centre.active ? 'Centre deactivated' : 'Centre activated', 'success')
    void load()
  }

  async function addAssignment() {
    if (!assignmentStaffId || !assignmentCentreId) return
    setSavingId('assignment')
    const { error: err } = await supabase.from('staff_centres').insert({ staff_id: assignmentStaffId, centre_id: assignmentCentreId })
    setSavingId(null)
    if (err) {
      notify(err.message, 'error')
      return
    }
    setAssignmentStaffId('')
    setAssignmentCentreId('')
    notify('Centre assignment added', 'success')
    void load()
  }

  async function removeAssignment(assignment: StaffCentre) {
    setSavingId(`${assignment.staff_id}-${assignment.centre_id}`)
    const { error: err } = await supabase
      .from('staff_centres')
      .delete()
      .eq('staff_id', assignment.staff_id)
      .eq('centre_id', assignment.centre_id)
    setSavingId(null)
    if (err) {
      notify(err.message, 'error')
      return
    }
    notify('Centre assignment removed', 'success')
    void load()
  }

  if (loading) return <LoadingPanel label="Loading staff…" />
  if (error) return <ErrorPanel message={error} onRetry={() => void load()} />

  return (
    <div>
      <PageHeader title="Staff & centres" subtitle="Manage staff roles, centre access, and active centres" accent="red" />

      <section className="card p-4 mb-5">
        <h2 className="font-semibold mb-3">Centres</h2>
        <form className="flex gap-2 mb-4" onSubmit={(event) => { event.preventDefault(); void addCentre() }}>
          <input className="flex-1 p-2 border border-slate-200 rounded-lg text-sm" placeholder="New centre name" value={newCentreName} onChange={(event) => setNewCentreName(event.target.value)} disabled={savingId === 'new-centre'} />
          <button className="btn-primary" type="submit" disabled={savingId === 'new-centre' || !newCentreName.trim()}>Add centre</button>
        </form>
        {centres.length === 0 ? <EmptyState title="No centres found" /> : (
          <div className="divide-y divide-slate-100">
            {centres.map((centre) => (
              <div key={centre.id} className="py-2 flex items-center justify-between gap-3">
                <div>
                  <div className="font-medium text-sm">{centre.name}</div>
                  <div className="text-xs text-slate-500">{centre.active ? 'Active' : 'Inactive'}</div>
                </div>
                <button className="btn-ghost text-sm" onClick={() => void toggleCentre(centre)} disabled={savingId === centre.id}>
                  {centre.active ? 'Deactivate' : 'Activate'}
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="card p-4 mb-5">
        <h2 className="font-semibold mb-3">Centre assignments</h2>
        <div className="grid sm:grid-cols-[1fr_1fr_auto] gap-2 mb-4">
          <select className="p-2 border border-slate-200 rounded-lg text-sm" value={assignmentStaffId} onChange={(event) => setAssignmentStaffId(event.target.value)} aria-label="Staff member">
            <option value="">Choose staff</option>
            {profiles.filter((profile) => profile.auth_id).map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
          </select>
          <select className="p-2 border border-slate-200 rounded-lg text-sm" value={assignmentCentreId} onChange={(event) => setAssignmentCentreId(event.target.value)} aria-label="Centre">
            <option value="">Choose centre</option>
            {centres.filter((centre) => centre.active).map((centre) => <option key={centre.id} value={centre.id}>{centre.name}</option>)}
          </select>
          <button className="btn-primary" onClick={() => void addAssignment()} disabled={savingId === 'assignment' || !assignmentStaffId || !assignmentCentreId}>Assign</button>
        </div>
        <div className="divide-y divide-slate-100">
          {assignments.map((assignment) => {
            const staff = profiles.find((profile) => profile.id === assignment.staff_id)
            const centre = centres.find((item) => item.id === assignment.centre_id)
            return (
              <div key={`${assignment.staff_id}-${assignment.centre_id}`} className="py-2 flex items-center justify-between gap-3 text-sm">
                <span>{staff?.name ?? 'Unknown staff'} · {centre?.name ?? 'Unknown centre'}</span>
                <button className="btn-ghost text-xs" onClick={() => void removeAssignment(assignment)} disabled={savingId === `${assignment.staff_id}-${assignment.centre_id}`}>Remove</button>
              </div>
            )
          })}
        </div>
      </section>

      <section className="card divide-y divide-slate-100">
        <h2 className="font-semibold p-4">Staff roles</h2>
        {profiles.length === 0 ? <EmptyState title="No staff profiles found" /> : profiles.map((p) => (
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
              {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
        ))}
      </section>
    </div>
  )
}
