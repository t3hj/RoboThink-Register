import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../lib/auth'
import { useBrand } from '../lib/brand'
import { useCentres } from '../lib/centres'
import { useToast } from '../components/Toast'
import { PageHeader, LoadingPanel, ErrorPanel, EmptyState, BusyButton } from '../components/ui'
import SessionSlotsEditor, { validSlots, type SlotInput } from '../components/SessionSlotsEditor'
import StudentForm from '../components/StudentForm'
import { describeSlots } from '../lib/attendanceStats'
import { formatTime12h, todayISO } from '../lib/dates'
import type { StudentRequest, StudentRequestPayload, Subscription } from '../types'

interface Draft {
  full_name: string
  subscription_id: number | ''
  slots: SlotInput[]
  pattern: 'weekly' | 'fortnightly'
  anchor: string
  notes: string
}

const emptyDraft = (): Draft => ({ full_name: '', subscription_id: '', slots: [{ day: '', time: '' }], pattern: 'weekly', anchor: '', notes: '' })

const STATUS_STYLE: Record<StudentRequest['status'], string> = {
  pending: 'badge-assess',
  approved: 'bg-[color:var(--rt-green-tint)] text-emerald-800',
  rejected: 'bg-rose-50 text-rose-700',
}

/** Instructors ask for students to be added; admins and managers review and
 *  approve. Approving opens the normal Add student form pre-filled, so the
 *  student is only created once a reviewer saves it. */
export default function Requests() {
  const { role, profile } = useAuth()
  const { activeBrand } = useBrand()
  const { activeCentres, selectedCentreId } = useCentres()
  const { notify } = useToast()
  const canReview = role === 'admin' || role === 'management'

  const [requests, setRequests] = useState<StudentRequest[]>([])
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [centreId, setCentreId] = useState<string>(selectedCentreId ?? '')
  const [drafts, setDrafts] = useState<Draft[]>([emptyDraft()])
  const [sending, setSending] = useState(false)
  const [reviewing, setReviewing] = useState<StudentRequest | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const [reqRes, subRes] = await Promise.all([
      supabase
        .from('student_requests')
        .select('*, centres(name), requester:profiles!student_requests_requested_by_fkey(full_name:name)')
        .order('created_at', { ascending: false })
        .limit(100),
      supabase.from('subscriptions').select('*').order('id'),
    ])
    if (reqRes.error) setError(reqRes.error.message)
    else setRequests((reqRes.data ?? []) as unknown as StudentRequest[])
    setSubscriptions((subRes.data ?? []) as Subscription[])
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!centreId && selectedCentreId) setCentreId(selectedCentreId)
  }, [centreId, selectedCentreId])

  const updateDraft = (index: number, patch: Partial<Draft>) => setDrafts((all) => all.map((d, i) => (i === index ? { ...d, ...patch } : d)))

  async function submit() {
    if (!profile) return
    if (!centreId) return notify('Choose a centre.', 'error')
    for (const [i, d] of drafts.entries()) {
      const label = `Student ${i + 1}`
      if (!d.full_name.trim()) return notify(`${label}: enter a name.`, 'error')
      if (d.subscription_id === '') return notify(`${label}: choose a subscription.`, 'error')
      if (d.slots.some((s) => (s.day && !s.time) || (!s.day && s.time))) return notify(`${label}: each session needs a day and a time.`, 'error')
      if (validSlots(d.slots).length === 0) return notify(`${label}: add at least one session.`, 'error')
      if (d.pattern === 'fortnightly' && !d.anchor) return notify(`${label}: pick a date in a week they attend.`, 'error')
    }
    setSending(true)
    const rows = drafts.map((d) => {
      const payload: StudentRequestPayload = {
        full_name: d.full_name.trim(),
        subscription_id: d.subscription_id === '' ? null : d.subscription_id,
        slots: validSlots(d.slots),
        attendance_pattern: d.pattern,
        fortnight_anchor: d.pattern === 'fortnightly' ? d.anchor : null,
        notes: d.notes.trim() || null,
      }
      return { centre_id: centreId, brand: activeBrand, requested_by: profile.id, status: 'pending', payload }
    })
    const { error: insertError } = await supabase.from('student_requests').insert(rows)
    setSending(false)
    if (insertError) return notify(insertError.message, 'error')
    notify(`${rows.length} request${rows.length === 1 ? '' : 's'} sent for approval`, 'success')
    setDrafts([emptyDraft()])
    void load()
  }

  async function decide(request: StudentRequest, status: 'approved' | 'rejected', extra: { note?: string; studentId?: string } = {}) {
    if (!profile) return
    const { error: updateError } = await supabase
      .from('student_requests')
      .update({
        status,
        review_note: extra.note ?? null,
        reviewed_by: profile.id,
        reviewed_at: new Date().toISOString(),
        created_student_id: extra.studentId ?? null,
      })
      .eq('id', request.id)
      .eq('status', 'pending')
    if (updateError) notify(updateError.message, 'error')
    void load()
  }

  function reject(request: StudentRequest) {
    const note = window.prompt(`Why is “${request.payload.full_name}” being declined? (the instructor will see this)`)
    if (note === null) return
    void decide(request, 'rejected', { note: note.trim() || undefined })
  }

  const pending = requests.filter((r) => r.status === 'pending')
  const decided = requests.filter((r) => r.status !== 'pending')
  const subName = (id: number | null) => subscriptions.find((s) => s.id === id)?.name ?? '—'
  const centreName = (id: string) => activeCentres.find((c) => c.id === id)?.name

  const summary = (p: StudentRequestPayload) =>
    `${describeSlots({ preferred_day: null, student_schedules: p.slots.map((s) => ({ day_of_week: s.day, start_time: s.time })) }, formatTime12h)}${p.attendance_pattern === 'fortnightly' ? ' · every other week' : ''} · ${subName(p.subscription_id)}`

  return (
    <div>
      <PageHeader
        title="Student requests"
        subtitle={canReview ? 'Review students instructors have asked to add' : 'Ask for new students to be added. An admin or manager approves them'}
        accent="yellow"
      />

      {loading ? (
        <LoadingPanel />
      ) : error ? (
        <ErrorPanel message={error} onRetry={() => void load()} />
      ) : (
        <>
          {canReview && (
            <section className="card p-4 mb-6" aria-labelledby="pending-heading">
              <div className="flex items-center justify-between mb-3">
                <h2 id="pending-heading" className="font-semibold">Waiting for review</h2>
                <span className={`badge ${pending.length ? 'badge-assess' : ''}`}>{pending.length}</span>
              </div>
              {pending.length === 0 ? (
                <EmptyState title="No requests waiting" />
              ) : (
                <ul className="divide-y divide-slate-100">
                  {pending.map((r) => (
                    <li key={r.id} className="py-3 flex flex-wrap items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-medium">{r.payload.full_name}</div>
                        <div className="text-xs text-slate-600">{summary(r.payload)}</div>
                        <div className="text-xs text-slate-600">
                          {r.centres?.name ?? centreName(r.centre_id) ?? 'Centre'} · requested by {r.requester?.full_name ?? 'staff'} · {r.created_at.slice(0, 10)}
                        </div>
                        {r.payload.notes && <div className="text-xs text-slate-600 mt-1">Note: {r.payload.notes}</div>}
                      </div>
                      <div className="flex gap-2">
                        <button className="btn-primary" onClick={() => setReviewing(r)}>Review &amp; add</button>
                        <button className="btn-ghost" onClick={() => reject(r)}>Decline</button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          <section className="card p-4 mb-6" aria-labelledby="new-heading">
            <h2 id="new-heading" className="font-semibold mb-1">{canReview ? 'Add students in bulk by request' : 'Request new students'}</h2>
            <p className="text-xs text-slate-600 mb-3">
              You can request several students at once. Nothing is added until an admin or manager approves it.
              {canReview && ' To add a student straight away, use Students, then Add student.'}
            </p>

            <label className="text-sm block mb-3 max-w-sm">
              <span className="block text-slate-600 mb-1">Centre</span>
              <select className="w-full p-2 border border-slate-200 rounded-lg text-sm" value={centreId} onChange={(e) => setCentreId(e.target.value)} disabled={sending}>
                <option value="">— Choose a centre —</option>
                {activeCentres.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </label>

            <div className="space-y-4">
              {drafts.map((d, i) => (
                <div key={i} className="rounded-xl border border-slate-200 p-3 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">Student {i + 1}</span>
                    {drafts.length > 1 && (
                      <button type="button" className="btn-ghost text-xs" onClick={() => setDrafts((all) => all.filter((_, x) => x !== i))}>Remove</button>
                    )}
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <label className="text-sm block">
                      <span className="block text-slate-600 mb-1">Full name</span>
                      <input className="w-full p-2 border border-slate-200 rounded-lg text-sm" value={d.full_name} onChange={(e) => updateDraft(i, { full_name: e.target.value })} disabled={sending} />
                    </label>
                    <label className="text-sm block">
                      <span className="block text-slate-600 mb-1">Subscription</span>
                      <select className="w-full p-2 border border-slate-200 rounded-lg text-sm" value={d.subscription_id} onChange={(e) => updateDraft(i, { subscription_id: e.target.value === '' ? '' : Number(e.target.value) })} disabled={sending}>
                        <option value="">— Choose —</option>
                        {subscriptions.map((s) => (
                          <option key={s.id} value={s.id}>{s.name}</option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <SessionSlotsEditor slots={d.slots} onChange={(slots) => updateDraft(i, { slots })} disabled={sending} />
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <label className="text-sm block">
                      <span className="block text-slate-600 mb-1">How often</span>
                      <select
                        className="w-full p-2 border border-slate-200 rounded-lg text-sm"
                        value={d.pattern}
                        onChange={(e) => {
                          const pattern = e.target.value as 'weekly' | 'fortnightly'
                          updateDraft(i, { pattern, anchor: pattern === 'fortnightly' && !d.anchor ? todayISO() : d.anchor })
                        }}
                        disabled={sending}
                      >
                        <option value="weekly">Every week</option>
                        <option value="fortnightly">Every other week</option>
                      </select>
                    </label>
                    {d.pattern === 'fortnightly' && (
                      <label className="text-sm block">
                        <span className="block text-slate-600 mb-1">A week they attend (any date in it)</span>
                        <input type="date" className="w-full p-2 border border-slate-200 rounded-lg text-sm" value={d.anchor} onChange={(e) => updateDraft(i, { anchor: e.target.value })} disabled={sending} />
                      </label>
                    )}
                  </div>
                  <label className="text-sm block">
                    <span className="block text-slate-600 mb-1">Note for the reviewer (optional, e.g. starting level)</span>
                    <input className="w-full p-2 border border-slate-200 rounded-lg text-sm" value={d.notes} onChange={(e) => updateDraft(i, { notes: e.target.value })} disabled={sending} />
                  </label>
                </div>
              ))}
            </div>

            <div className="flex flex-wrap gap-2 mt-4">
              <button type="button" className="btn-ghost" onClick={() => setDrafts((all) => [...all, emptyDraft()])} disabled={sending}>+ Add another student</button>
              <BusyButton busy={sending} onClick={() => void submit()}>
                Send {drafts.length} request{drafts.length === 1 ? '' : 's'} for approval
              </BusyButton>
            </div>
          </section>

          <section className="card p-4" aria-labelledby="history-heading">
            <h2 id="history-heading" className="font-semibold mb-3">{canReview ? 'Recent decisions' : 'Your requests'}</h2>
            {(canReview ? decided : requests).length === 0 ? (
              <EmptyState title="Nothing here yet" />
            ) : (
              <ul className="divide-y divide-slate-100">
                {(canReview ? decided : requests).map((r) => (
                  <li key={r.id} className="py-2 flex flex-wrap items-center justify-between gap-2 text-sm">
                    <div className="min-w-0">
                      <span className="font-medium">{r.payload.full_name}</span>
                      <span className="text-xs text-slate-600"> · {summary(r.payload)} · {r.created_at.slice(0, 10)}</span>
                      {r.status === 'rejected' && r.review_note && <div className="text-xs text-rose-700">Declined: {r.review_note}</div>}
                    </div>
                    <span className={`badge badge-dot capitalize ${STATUS_STYLE[r.status]}`}>{r.status}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}

      {reviewing && (
        <StudentForm
          prefill={{ payload: reviewing.payload, centreId: reviewing.centre_id }}
          onClose={() => setReviewing(null)}
          onSaved={(saved) => {
            const request = reviewing
            setReviewing(null)
            if (saved?.id) void decide(request, 'approved', { studentId: saved.id })
          }}
        />
      )}
    </div>
  )
}
