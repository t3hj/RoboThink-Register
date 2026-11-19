import { useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { useToast } from './Toast'
import { BusyButton } from './ui'
import { isRemediationDue, remediationStatusLabel } from '../lib/assessment'
import type { RemediationPlan } from '../types'

interface Props {
  studentId: string
  pendingAssessmentPointId: string | null
  focusTopic: string | null
  plan: RemediationPlan | null
  date?: string
  attended?: boolean
  onDone?: () => void
}

function RemediationLessonForm({ studentId, plan, date, onDone }: {
  studentId: string
  plan: RemediationPlan
  date: string
  onDone?: () => void
}) {
  const { notify } = useToast()
  const [title, setTitle] = useState('')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const sessionId = useRef<string | null>(null)
  const saving = useRef(false)

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (saving.current || !title.trim()) return
    saving.current = true
    setBusy(true)
    setError(null)
    try {
      sessionId.current ??= crypto.randomUUID()
      const { error: saveError } = await supabase.rpc('record_remediation_lesson_session', {
        in_student_id: studentId,
        in_plan_id: plan.id,
        in_lesson_number: plan.lessons_completed + 1,
        in_date: date,
        in_session_id: sessionId.current,
        in_title: title.trim(),
        in_notes: notes.trim() || null,
      })
      if (saveError) {
        setError(saveError.message)
        return
      }
      notify('Remediation lesson recorded', 'success')
      onDone?.()
    } finally {
      saving.current = false
      setBusy(false)
    }
  }

  const fieldClass = 'mt-1 block w-full rounded-lg border border-amber-200 bg-white p-2 text-sm text-slate-900'
  return (
    <form className="mt-3 grid gap-2" onSubmit={(event) => void save(event)}>
      <label>
        <span className="font-medium">Remediation lesson {plan.lessons_completed + 1} title</span>
        <input className={fieldClass} value={title} onChange={(event) => setTitle(event.target.value)} required maxLength={120} disabled={busy} />
      </label>
      <label>
        <span className="font-medium">Lesson notes (optional)</span>
        <textarea className={fieldClass} value={notes} onChange={(event) => setNotes(event.target.value)} rows={2} maxLength={1000} disabled={busy} />
      </label>
      {error && <p className="text-sm text-rose-800" role="alert">{error}</p>}
      <div>
        <BusyButton type="submit" busy={busy} disabled={!title.trim()}>Record completed remediation lesson</BusyButton>
      </div>
    </form>
  )
}

export default function AssessmentPanel({ studentId, pendingAssessmentPointId, focusTopic, plan, date, attended, onDone }: Props) {
  const status = remediationStatusLabel(plan)
  const focus = plan?.assessment?.notes
  const focusNote = focus && <p className="mt-1 whitespace-pre-wrap break-words"><strong>Skills to practise</strong> · {focus}</p>

  if (plan?.status === 'intervention_required') {
    return (
      <div className="card border-rose-300 bg-rose-50 p-3 text-sm text-rose-800">
        <div className="font-semibold">{status?.label}</div>
        <div>Reassessment was not passed after remediation. This needs manual follow-up before further progress.</div>
        {focusNote}
      </div>
    )
  }

  if (isRemediationDue(plan)) {
    return (
      <div className="card border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
        <div className="font-semibold">
          {status?.label}
          {plan.topic ? ` · ${plan.topic}` : ''}
        </div>
        {focusNote}
        {date ? (
          attended ? (
            <RemediationLessonForm
              key={`${date}/${plan.id}/${plan.lessons_completed}`}
              studentId={studentId}
              plan={plan}
              date={date}
              onDone={onDone}
            />
          ) : (
            <p className="mt-2 text-xs">Mark the student attended to record a completed remediation lesson.</p>
          )
        ) : (
          <Link to="/register" className="mt-2 inline-block text-xs font-medium underline">Open Register to record a remediation lesson</Link>
        )}
      </div>
    )
  }

  if (plan?.status === 'ready_for_reassessment' || pendingAssessmentPointId) {
    const isReassessment = plan?.status === 'ready_for_reassessment'
    return (
      <div className="card border-sky-200 bg-sky-50 p-3 text-sm text-sky-900">
        <div className="font-semibold">
          {status?.label ?? 'Assessment due'}
          {focusTopic ? ` · ${focusTopic}` : ''}
        </div>
        {focusNote}
        <p className="mt-2 text-xs">
          {isReassessment ? 'Select the reassessment lesson' : 'Select the assessment lesson'} in the Register lesson picker to record PASS/FAIL with the session.
        </p>
        {!date && <Link to="/register" className="mt-2 inline-block text-xs font-medium underline">Open Register</Link>}
      </div>
    )
  }

  return null
}
