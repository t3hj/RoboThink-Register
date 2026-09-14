import { useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../lib/auth'
import { useToast } from './Toast'
import { FEEDBACK_OPTIONS, feedbackReminderText } from '../lib/feedback'
import type { FeedbackStatus } from '../types'

interface Props {
  feedbackId: string
  status: FeedbackStatus
  studentName: string
  onChanged: () => void
  /** Compact: just the reminder text + a "Given out" button (used in the
   *  Register row and the reminders summary). Full: the complete
   *  not-written/written/given select (used on the Student page). */
  variant?: 'compact' | 'full'
}

/** Updates a feedback_sheets row. Attendance never touches this table —
 *  status only changes when the instructor explicitly picks one here. */
export default function FeedbackControl({ feedbackId, status, studentName, onChanged, variant = 'compact' }: Props) {
  const { profile } = useAuth()
  const { notify } = useToast()
  const [busy, setBusy] = useState(false)

  async function setStatus(next: FeedbackStatus) {
    if (!profile) {
      notify('Your profile is not loaded — cannot record who made this change.', 'error')
      return
    }
    setBusy(true)
    const { error } = await supabase
      .from('feedback_sheets')
      .update({ status: next, updated_by: profile.id })
      .eq('id', feedbackId)
    setBusy(false)
    if (error) {
      notify(error.message, 'error')
      return
    }
    notify(
      next === 'given' ? `Feedback marked as given to ${studentName}` : `Feedback sheet updated for ${studentName}`,
      'success',
    )
    onChanged()
  }

  if (variant === 'full') {
    return (
      <select
        className="p-1.5 border border-slate-200 rounded-lg text-sm"
        value={status}
        disabled={busy}
        onChange={(e) => void setStatus(e.target.value as FeedbackStatus)}
        aria-label={`Feedback sheet status for ${studentName}`}
      >
        {FEEDBACK_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    )
  }

  const reminder = feedbackReminderText(status)
  if (!reminder) return null

  return (
    <div className="flex items-center gap-2 flex-wrap text-sm">
      <span className="inline-flex items-center gap-1.5 text-amber-800 bg-amber-50 border border-amber-200 rounded-full px-2.5 py-0.5">
        <span aria-hidden>📝</span> {reminder}
      </span>
      {status === 'not_written' && (
        <button className="btn-ghost text-xs py-1" disabled={busy} onClick={() => void setStatus('written_not_taken')}>
          Mark written
        </button>
      )}
      <button className="btn-ghost text-xs py-1" disabled={busy} onClick={() => void setStatus('given')}>
        Given out
      </button>
    </div>
  )
}
