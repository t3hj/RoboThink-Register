import { useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../lib/auth'
import { useToast } from './Toast'
import { BusyButton } from './ui'
import { FEEDBACK_OPTIONS } from '../lib/feedback'
import { eligibleForFeedback, summarizeBulkResults, type BulkCandidate } from '../lib/bulkActions'
import type { FeedbackStatus } from '../types'

interface FeedbackCandidate extends BulkCandidate {
  /** The feedback_sheets.id belonging to this student's target session for
   *  the selected date — resolved by the caller (their most recent
   *  session that date), never their whole feedback history. */
  feedbackId: string | null
}

interface Props {
  candidates: FeedbackCandidate[]
  onDone: () => void
  onClose: () => void
}

export default function BulkFeedbackModal({ candidates, onDone, onClose }: Props) {
  const { profile } = useAuth()
  const { notify } = useToast()
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<FeedbackStatus>('given')
  const [step, setStep] = useState<'configure' | 'review'>('configure')

  // Eligible = has a session (and therefore a feedback row) for the date.
  const base = eligibleForFeedback(candidates)
  // A student with a session but somehow no feedback row (shouldn't
  // normally happen — every session gets one automatically) is also
  // skipped, defensively, rather than silently doing nothing.
  const eligible = base.eligible.filter((c) => c.feedbackId != null)
  const skipped = [
    ...base.skipped,
    ...base.eligible.filter((c) => c.feedbackId == null).map((c) => ({ candidate: c, reason: 'No feedback record found for their session' })),
  ]

  async function apply() {
    if (!profile) {
      notify('Your profile is not loaded — cannot record who made this change.', 'error')
      return
    }
    setBusy(true)
    // Each update targets one specific feedback_sheets.id (that student's
    // session for THIS date) — never a broader student-wide update, so a
    // student with Session 1 + Session 2 that date only has the intended
    // one touched.
    const results = await Promise.allSettled(
      eligible.map((c) =>
        supabase
          .from('feedback_sheets')
          .update({ status, updated_by: profile.id })
          .eq('id', c.feedbackId as string)
          .then(({ error }) => {
            if (error) throw error
          }),
      ),
    )
    setBusy(false)
    const summary = summarizeBulkResults(
      eligible.map((c) => ({ id: c.id, name: c.full_name })),
      results,
    )
    if (summary.failed.length === 0) {
      notify(`Feedback updated for ${summary.succeeded.length} student${summary.succeeded.length === 1 ? '' : 's'}`, 'success')
    } else {
      notify(`${summary.succeeded.length} updated, ${summary.failed.length} failed: ${summary.failed.map((f) => f.name).join(', ')}`, 'error')
    }
    onDone()
  }

  return (
    <div className="fixed inset-0 z-40 flex items-start sm:items-center justify-center bg-black/40 p-4 overflow-y-auto" onClick={onClose}>
      <div className="card p-5 max-w-md w-full my-8" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Bulk feedback">
        <h3 className="font-semibold mb-1">Bulk feedback status</h3>
        <p className="text-xs text-slate-500 mb-3">
          Only updates each student's session for the selected date — never their full feedback history.
        </p>

        {step === 'configure' && (
          <label className="text-sm block mb-3">
            <span className="block text-slate-500 mb-1">Set status to</span>
            <select className="w-full p-2 border border-slate-200 rounded-lg text-sm" value={status} onChange={(e) => setStatus(e.target.value as FeedbackStatus)}>
              {FEEDBACK_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
        )}

        {step === 'review' && (
          <div className="flex flex-col gap-3 mb-3">
            <p className="text-sm">Apply to {candidates.length} student{candidates.length === 1 ? '' : 's'}?</p>
            {eligible.length > 0 && (
              <div>
                <div className="text-sm font-medium mb-1">{eligible.length} will be updated</div>
                <ul className="text-sm text-slate-600 max-h-40 overflow-y-auto">
                  {eligible.map((c) => {
                    const sessionLabel = c.targetSessionNumber != null && c.sessionCount > 1 ? ` (Session ${c.targetSessionNumber})` : ''
                    return <li key={c.id}>{c.full_name}{sessionLabel}</li>
                  })}
                </ul>
              </div>
            )}
            {skipped.length > 0 && (
              <div>
                <div className="text-sm font-medium mb-1">{skipped.length} will be skipped</div>
                <ul className="text-sm text-slate-500 max-h-32 overflow-y-auto">
                  {skipped.map(({ candidate, reason }) => <li key={candidate.id}>{candidate.full_name} — {reason}</li>)}
                </ul>
              </div>
            )}
          </div>
        )}

        <div className="flex justify-end gap-2 mt-4">
          <button className="btn-ghost" onClick={step === 'review' ? () => setStep('configure') : onClose} disabled={busy}>
            {step === 'review' ? 'Back' : 'Cancel'}
          </button>
          {step === 'configure' ? (
            <button className="btn-primary" disabled={eligible.length === 0} onClick={() => setStep('review')}>
              Review
            </button>
          ) : (
            <BusyButton busy={busy} disabled={eligible.length === 0} onClick={() => void apply()}>
              Apply to {eligible.length}
            </BusyButton>
          )}
        </div>
      </div>
    </div>
  )
}
