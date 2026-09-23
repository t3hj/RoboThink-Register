import { useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useToast } from './Toast'
import { BusyButton } from './ui'
import { todayISO } from '../lib/dates'
import { REMEDIATION_PATH_OPTIONS, remediationStatusLabel } from '../lib/assessment'
import type { RemediationPath, RemediationPlan } from '../types'

interface Props {
  studentId: string
  studentName: string
  pendingAssessmentPointId: string | null
  focusTopic: string | null
  plan: RemediationPlan | null
  /** The specific attended session this assessment/remediation event
   *  belongs to — required before recording anything, so results are
   *  always historically traceable to the right session (and never
   *  accidentally attached to the wrong one of two same-day sessions). */
  sessionId: string | null
  onDone: () => void
  /** Compact mode is used inline in the register row; full mode on the profile page. */
  compact?: boolean
}

/** Surfaces the PASS/FAIL -> repeat-next-lesson OR 3-remediation-lessons ->
 *  reassessment -> intervention workflow wherever a student needs it. */
export default function AssessmentPanel({
  studentId,
  studentName,
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
  const [failPath, setFailPath] = useState<RemediationPath | ''>('')

  const isFreshFail = !(plan?.status === 'ready_for_reassessment') // path choice only applies to a first-time FAIL

  async function recordResult(result: 'PASS' | 'FAIL') {
    if (result === 'FAIL' && isFreshFail && !failPath) {
      notify('Choose a remediation path before recording a FAIL.', 'error')
      return
    }
    setBusy(true)
    const { error } = await supabase.rpc('record_assessment_result', {
      in_student_id: studentId,
      in_result: result,
      in_date: todayISO(),
      in_notes: notes.trim() || null,
      in_attended_session_id: sessionId,
      in_remediation_path: result === 'FAIL' && isFreshFail ? failPath : 'remediation_lessons',
    })
    setBusy(false)
    if (error) {
      notify(error.message, 'error')
      return
    }
    notify(
      result === 'PASS'
        ? `${studentName} passed — progressing normally`
        : isFreshFail && failPath === 'repeat_next_lesson'
          ? `${studentName} will repeat the assessment next lesson`
          : `${studentName} needs 3 remediation lessons`,
      result === 'PASS' ? 'success' : 'info',
    )
    setNotes('')
    setFailPath('')
    onDone()
  }

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
        {!sessionId ? (
          <p className="text-xs mt-2">Record today's session first, then the {isReassessment ? 'reassessment' : 'assessment'} result can be logged against it.</p>
        ) : (
          <>
            {!isReassessment && (
              <fieldset className="mt-2">
                <legend className="text-xs mb-1">If FAIL, remediation path (required before saving a FAIL):</legend>
                <div className="flex flex-col gap-1">
                  {REMEDIATION_PATH_OPTIONS.map((opt) => (
                    <label key={opt.value} className="flex items-start gap-1.5 text-xs">
                      <input type="radio" name={`fail-path-${studentId}`} className="mt-0.5" checked={failPath === opt.value} onChange={() => setFailPath(opt.value)} disabled={busy} />
                      <span>{opt.label}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
            )}
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
          </>
        )}
      </div>
    )
  }

  return null
}
