import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../lib/auth'
import { useToast } from './Toast'
import { BusyButton } from './ui'
import type { AttendanceSessionType, Student } from '../types'

interface Props {
  date: string
  dayLabel: string
  excludeIds: Set<string>
  onAdded: () => void
  onClose: () => void
}

const REASONS: { value: AttendanceSessionType; label: string; hint: string }[] = [
  { value: 'regular', label: 'Regular session', hint: 'A normal session, added manually' },
  { value: 'catch_up', label: 'Catch-up', hint: "Making up a missed session" },
  { value: 'special', label: 'Special session', hint: 'One-off or extra session' },
]

/** Lets staff search for an existing student and add them to today's
 *  register without touching their normal preferred_day/preferred_time —
 *  this only ever writes an attendance row for today's date. The unique
 *  constraint on (student_id, date) means this can never create a
 *  duplicate: adding someone already on the register just updates their
 *  existing row. */
export default function AddToRegister({ date, dayLabel, excludeIds, onAdded, onClose }: Props) {
  const { profile } = useAuth()
  const { notify } = useToast()
  const [query, setQuery] = useState('')
  const [students, setStudents] = useState<Student[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<Student | null>(null)
  const [reason, setReason] = useState<AttendanceSessionType>('catch_up')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    supabase
      .from('students')
      .select('*')
      .eq('active', true)
      .order('full_name')
      .then(({ data, error }) => {
        if (cancelled) return
        if (error) notify(error.message, 'error')
        else setStudents((data ?? []) as Student[])
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    const pool = students.filter((s) => !excludeIds.has(s.id))
    if (!q) return pool.slice(0, 8)
    return pool.filter((s) => s.full_name.toLowerCase().includes(q)).slice(0, 20)
  }, [students, query, excludeIds])

  async function add() {
    if (!selected) return
    if (!profile) {
      notify('Your profile is not loaded — cannot record who made this change.', 'error')
      return
    }
    setBusy(true)
    const { error } = await supabase.from('attendance').upsert(
      {
        student_id: selected.id,
        date,
        scheduled_day: selected.preferred_day ?? dayLabel,
        actual_day: dayLabel,
        instructor_id: profile.id,
        status: 'Not Arrived',
        session_type: reason,
      },
      { onConflict: 'student_id,date' },
    )
    setBusy(false)
    if (error) {
      notify(error.message, 'error')
      return
    }
    notify(`${selected.full_name} added to today's register`, 'success')
    onAdded()
  }

  return (
    <div className="fixed inset-0 z-40 flex items-start sm:items-center justify-center bg-black/40 p-4 overflow-y-auto" onClick={onClose}>
      <div className="card p-5 max-w-md w-full my-8" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Add student to today's register">
        <h3 className="font-semibold mb-1">Add to today's register</h3>
        <p className="text-xs text-slate-500 mb-4">Their normal day/time won't change — this only adds today's session.</p>

        {!selected ? (
          <>
            <input
              type="search"
              autoFocus
              placeholder="Search students…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full p-2 border border-slate-200 rounded-lg text-sm mb-2"
              aria-label="Search students"
            />
            {loading ? (
              <div className="text-sm text-slate-400 py-4 text-center">Loading students…</div>
            ) : results.length === 0 ? (
              <div className="text-sm text-slate-400 py-4 text-center">No matching students.</div>
            ) : (
              <ul className="max-h-64 overflow-y-auto divide-y divide-slate-100 border border-slate-100 rounded-lg">
                {results.map((s) => (
                  <li key={s.id}>
                    <button
                      className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50"
                      onClick={() => setSelected(s)}
                    >
                      {s.full_name}
                      <span className="text-slate-400"> · {s.preferred_day ?? 'no set day'}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : (
          <>
            <div className="mb-3 flex items-center justify-between bg-slate-50 rounded-lg p-2.5">
              <span className="font-medium text-sm">{selected.full_name}</span>
              <button className="text-xs text-slate-500 hover:underline" onClick={() => setSelected(null)}>Change</button>
            </div>
            <fieldset className="mb-4">
              <legend className="text-sm text-slate-500 mb-1.5">Reason</legend>
              <div className="space-y-1.5">
                {REASONS.map((r) => (
                  <label key={r.value} className="flex items-start gap-2 text-sm p-2 border border-slate-200 rounded-lg has-[:checked]:border-[color:var(--rt-blue)] has-[:checked]:bg-[color:var(--rt-blue-tint)] cursor-pointer">
                    <input
                      type="radio"
                      name="reason"
                      className="mt-0.5"
                      checked={reason === r.value}
                      onChange={() => setReason(r.value)}
                      disabled={busy}
                    />
                    <span>
                      <span className="font-medium block">{r.label}</span>
                      <span className="text-xs text-slate-500">{r.hint}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          </>
        )}

        <div className="flex justify-end gap-2 mt-4">
          <button className="btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
          {selected && (
            <BusyButton busy={busy} onClick={() => void add()}>Add to register</BusyButton>
          )}
        </div>
      </div>
    </div>
  )
}
