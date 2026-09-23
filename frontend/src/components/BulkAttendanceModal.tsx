import { useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../lib/auth'
import { useToast } from './Toast'
import { BusyButton } from './ui'
import { eligibleForMarkAttended, eligibleForMarkAbsent, summarizeBulkResults, type BulkCandidate } from '../lib/bulkActions'

interface Props {
  target: 'Arrived' | 'Absent'
  candidates: BulkCandidate[]
  date: string
  dayLabel: string
  onDone: () => void
  onClose: () => void
}

/** Shared modal for the two purely-attendance bulk actions. Never touches
 *  attended_sessions either way — marking Absent in bulk explicitly does
 *  not remove any session a student already has recorded. */
export default function BulkAttendanceModal({ target, candidates, date, dayLabel, onDone, onClose }: Props) {
  const { profile } = useAuth()
  const { notify } = useToast()
  const [busy, setBusy] = useState(false)

  const { eligible, skipped } = target === 'Arrived' ? eligibleForMarkAttended(candidates) : eligibleForMarkAbsent(candidates)
  const hasExistingSessions = eligible.filter((c) => c.sessionCount > 0)

  async function apply() {
    if (!profile) {
      notify('Your profile is not loaded — cannot record who made this change.', 'error')
      return
    }
    setBusy(true)
    const rows = eligible.map((c) => ({
      student_id: c.id,
      date,
      scheduled_day: dayLabel,
      actual_day: dayLabel,
      instructor_id: profile.id,
      status: target,
      ...(target === 'Absent' ? { time_in: null, time_out: null } : {}),
    }))
    const results = await Promise.allSettled(
      rows.map((row) => supabase.from('attendance').upsert(row, { onConflict: 'student_id,date' }).then(({ error }) => {
        if (error) throw error
      })),
    )
    setBusy(false)
    const summary = summarizeBulkResults(
      eligible.map((c) => ({ id: c.id, name: c.full_name })),
      results,
    )
    if (summary.failed.length === 0) {
      notify(`${summary.succeeded.length} student${summary.succeeded.length === 1 ? '' : 's'} marked ${target === 'Arrived' ? 'Attended' : 'Absent'}`, 'success')
    } else {
      notify(`${summary.succeeded.length} updated, ${summary.failed.length} failed: ${summary.failed.map((f) => f.name).join(', ')}`, 'error')
    }
    onDone()
  }

  return (
    <div className="fixed inset-0 z-40 flex items-start sm:items-center justify-center bg-black/40 p-4 overflow-y-auto" onClick={onClose}>
      <div className="card p-5 max-w-md w-full my-8" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={`Bulk mark ${target}`}>
        <h3 className="font-semibold mb-1">Mark {target === 'Arrived' ? 'Attended' : 'Absent'}?</h3>
        <p className="text-sm text-slate-500 mb-3">Apply to {candidates.length} student{candidates.length === 1 ? '' : 's'}?</p>

        {eligible.length > 0 && (
          <div className="mb-3">
            <div className="text-sm font-medium mb-1">{eligible.length} will be updated</div>
            <ul className="text-sm text-slate-600 max-h-32 overflow-y-auto">
              {eligible.map((c) => <li key={c.id}>{c.full_name}</li>)}
            </ul>
          </div>
        )}
        {skipped.length > 0 && (
          <div className="mb-3">
            <div className="text-sm font-medium mb-1">{skipped.length} will be skipped</div>
            <ul className="text-sm text-slate-500 max-h-32 overflow-y-auto">
              {skipped.map(({ candidate, reason }) => <li key={candidate.id}>{candidate.full_name} — {reason}</li>)}
            </ul>
          </div>
        )}
        {target === 'Absent' && hasExistingSessions.length > 0 && (
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2 mb-3">
            {hasExistingSessions.length} of these already {hasExistingSessions.length === 1 ? 'has' : 'have'} a session recorded today —
            marking Absent will NOT delete it.
          </p>
        )}

        <div className="flex justify-end gap-2 mt-4">
          <button className="btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <BusyButton busy={busy} disabled={eligible.length === 0} onClick={() => void apply()}>
            Apply to {eligible.length}
          </BusyButton>
        </div>
      </div>
    </div>
  )
}
