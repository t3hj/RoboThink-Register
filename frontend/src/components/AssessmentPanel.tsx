import { useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { useToast } from './Toast'
import { BusyButton } from './ui'
import { todayISO } from '../lib/dates'
import { remediationStatusLabel } from '../lib/assessment'
import type { RemediationPlan } from '../types'

interface Props {
  studentId: string
  pendingAssessmentPointId: string | null
  focusTopic: string | null
  plan: RemediationPlan | null
  /** The specific regular attended session used to log a remediation lesson. */
  sessionId: string | null
  onDone: () => void
  /** Compact mode is used inline in the register row; full mode on the profile page. */
  compact?: boolean
}

/** Shows remediation progress. Assessment results are always recorded from
 *  the Register lesson picker so there is one PASS/FAIL entry flow. */
export default function AssessmentPanel({
  studentId,
  pendingAssessmentPointId,
  focusTopic,
  plan,
  sessionId,
  onDone,
  compact,
}: Props) {
  const { notify } = useToast()
  const [busy, setBusy] = useState(false)
  const [notes, setNotes] = useState('')

  async function completeRemediationLesson() {
    setBusy(true)
    const { error } = await supabase.rpc('complete_remediation_lesson', {
      in_student_id: studentId,
      in_date: todayISO(),
      in_notes: notes.trim() || null,
      in_attended_session_id: sessionId,
    })
    setBusy(false)
    if (error) {
      notify(error.message, 'error')
      return
    }
    notify('Remediation lesson recorded', 'success')
    setNotes('')
    onDone()
  }

  const status = remediationStatusLabel(plan)
  const toneClass = { warn: 'border-amber-200 bg-amber-50 text-amber-900', bad: 'border-rose-300 bg-rose-50 text-rose-800', info: 'border-sky-200 bg-sky-50 text-sky-900' }

  if (plan?.status === 'intervention_required') {
    return (
      <div className={`card p-3 ${toneClass.bad} text-sm ${compact ? '' : 'p-4'}`}>
        <div className="font-semibold">{status?.label}</div>
        <div>Reassessment was not passed after remediation. This needs manual follow-up before further progress.</div>
      </div>
    )
  }

  if (plan && (plan.status === 'required' || plan.status === 'in_progress')) {
    return (
      <div className={`card p-3 ${toneClass.warn} text-sm ${compact ? '' : 'p-4'}`}>
        <div className="font-semibold">
          {status?.label}
          {plan.topic ? ` · ${plan.topic}` : ''}
        </div>
        {!compact && <div className="mb-2">Failed assessment — 3 remediation lessons are required before reassessment.</div>}
        {!sessionId ? (
          <p className="text-xs mt-2">Record today's session first, then a remediation lesson can be logged against it.</p>
        ) : (
          <BusyButton className="btn-primary text-sm mt-2" busy={busy} onClick={() => void completeRemediationLesson()}>
            Complete remediation lesson
          </BusyButton>
        )}
      </div>
    )
  }

  if (plan?.status === 'ready_for_reassessment' || pendingAssessmentPointId) {
    const isReassessment = plan?.status === 'ready_for_reassessment'
    return (
      <div className={`card p-3 ${toneClass.info} text-sm ${compact ? '' : 'p-4'}`}>
        <div className="font-semibold">
          {status?.label ?? 'Assessment due'}
          {focusTopic ? ` · ${focusTopic}` : ''}
        </div>
        <p className="text-xs mt-2">
          {isReassessment ? 'Select the reassessment lesson' : 'Select the assessment lesson'} in the Register lesson picker to record PASS/FAIL with the session.
        </p>
        <Link to="/register" className="inline-block text-xs font-medium underline mt-2">Open Register</Link>
      </div>
    )
  }

  return null
}
