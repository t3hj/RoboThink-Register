import { useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useToast } from './Toast'
import { BusyButton } from './ui'
import { todayISO } from '../lib/dates'
import type { RemediationPlan } from '../types'

interface Props {
  studentId: string
  studentName: string
  pendingAssessmentPointId: string | null
  focusTopic: string | null
  plan: RemediationPlan | null
  onDone: () => void
  /** Compact mode is used inline in the register row; full mode on the profile page. */
  compact?: boolean
}

/** Surfaces the PASS/FAIL -> 3 remediation lessons -> reassessment ->
 *  intervention workflow (spec section 11) wherever a student needs it. */
export default function AssessmentPanel({
  studentId,
  studentName,
  pendingAssessmentPointId,
  focusTopic,
  plan,
  onDone,
  compact,
}: Props) {
  const { notify } = useToast()
  const [busy, setBusy] = useState(false)
  const [notes, setNotes] = useState('')

  async function recordResult(result: 'PASS' | 'FAIL') {
    setBusy(true)
    const { error } = await supabase.rpc('record_assessment_result', {
      in_student_id: studentId,
      in_result: result,
      in_date: todayISO(),
      in_notes: notes.trim() || null,
    })
    setBusy(false)
    if (error) {
      notify(error.message, 'error')
      return
    }
    notify(
      result === 'PASS' ? `${studentName} passed — progressing normally` : `${studentName} needs 3 remediation lessons`,
      result === 'PASS' ? 'success' : 'info',
    )
    setNotes('')
    onDone()
  }

  async function completeRemediationLesson() {
    setBusy(true)
    const { error } = await supabase.rpc('complete_remediation_lesson', {
      in_student_id: studentId,
      in_date: todayISO(),
      in_notes: notes.trim() || null,
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

  if (plan?.status === 'intervention_required') {
    return (
      <div className={`card p-3 border-rose-300 bg-rose-50 text-rose-800 text-sm ${compact ? '' : 'p-4'}`}>
        <div className="font-semibold">Intervention required</div>
        <div>Reassessment was not passed after remediation. This needs manual follow-up before further progress.</div>
      </div>
    )
  }

  if (plan && (plan.status === 'required' || plan.status === 'in_progress')) {
    return (
      <div className={`card p-3 border-amber-200 bg-amber-50 text-sm ${compact ? '' : 'p-4'}`}>
        <div className="font-semibold text-amber-900">
          Remediation {plan.lessons_completed}/{plan.lessons_required}
          {plan.topic ? ` · ${plan.topic}` : ''}
        </div>
        {!compact && (
          <div className="text-amber-800 mb-2">
            Failed assessment — 3 remediation lessons are required before reassessment.
          </div>
        )}
        <BusyButton className="btn-primary text-sm mt-2" busy={busy} onClick={() => void completeRemediationLesson()}>
          Complete remediation lesson
        </BusyButton>
      </div>
    )
  }

  if (plan?.status === 'ready_for_reassessment' || pendingAssessmentPointId) {
    const isReassessment = plan?.status === 'ready_for_reassessment'
    return (
      <div className={`card p-3 border-sky-200 bg-sky-50 text-sm ${compact ? '' : 'p-4'}`}>
        <div className="font-semibold text-sky-900">
          {isReassessment ? 'Ready for reassessment' : 'Assessment due'}
          {focusTopic ? ` · ${focusTopic}` : ''}
        </div>
        {!compact && (
          <input
            type="text"
            placeholder="Notes (optional)"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="w-full p-2 mt-2 border border-slate-200 rounded-lg text-sm"
            disabled={busy}
          />
        )}
        <div className="flex gap-2 mt-2">
          <BusyButton className="btn-primary text-sm" busy={busy} onClick={() => void recordResult('PASS')}>
            PASS
          </BusyButton>
          <BusyButton className="btn-ghost text-sm border border-rose-200 text-rose-700" busy={busy} onClick={() => void recordResult('FAIL')}>
            FAIL
          </BusyButton>
        </div>
      </div>
    )
  }

  return null
}
