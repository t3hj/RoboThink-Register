import { useMemo, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../lib/auth'
import { useToast } from './Toast'
import { BusyButton } from './ui'
import FeedbackControl from './FeedbackControl'
import { levelLabel } from '../lib/curriculum'
import { sessionRecommendedLesson } from '../lib/expectedLesson'
import { REMEDIATION_PATH_OPTIONS, requiresAssessmentResult } from '../lib/assessment'
import {
  NOT_FINISHED_REASONS,
  attendanceState,
  nearbyLessonNumbers,
  outcomeToAttendanceStatus,
  previouslyCompletedWarningDate,
  saveOperationFor,
  validateLeftAside,
  type RegisterAttendanceState,
} from '../lib/attendedSessionsUi'
import type { AssessmentResult, Attendance, AttendedSession, FeedbackSheet, Lesson, Level, LeftAsideReason, RemediationPath, RemediationPlan, SessionOutcome, Student, StudentProject } from '../types'

interface Props {
  student: Student
  date: string
  dayLabel: string
  levels: Level[]
  lessons: Lesson[]
  attendance: Attendance | null
  sessionsToday: AttendedSession[]
  projects: StudentProject[]
  plan: RemediationPlan | null
  feedbackBySessionId: Map<string, FeedbackSheet>
  /** `undefined` keeps the stored lesson; `null` means recorded history is
   *  authoritative but no next lesson can be resolved. A lesson value is the
   *  history-derived default, including across a term boundary. */
  expectedLesson?: Lesson | null
  /** Completed lessons by level and lesson number, with the date. */
  previouslyCompleted: Map<number, Map<number, string>>
  onChanged: () => void
}

type Draft = {
  lessonId: string
  outcome: SessionOutcome
  leftAside: boolean
  identifier: string
  reason: LeftAsideReason | ''
  note: string
  projectId: string
  assessmentResult: AssessmentResult | ''
  remediationPath: RemediationPath | ''
}

function blankDraft(defaultLessonId: string): Draft {
  return { lessonId: defaultLessonId, outcome: 'completed', leftAside: false, identifier: '', reason: '', note: '', projectId: '', assessmentResult: '', remediationPath: '' }
}

export default function SessionEntryRow({
  student,
  date,
  dayLabel,
  levels,
  lessons,
  attendance,
  sessionsToday,
  projects,
  plan,
  feedbackBySessionId,
  expectedLesson,
  previouslyCompleted,
  onChanged,
}: Props) {
  const { profile } = useAuth()
  const { notify } = useToast()
  const [busy, setBusy] = useState(false)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null)
  const [lessonScope, setLessonScope] = useState<'recommended' | 'nearby' | 'all'>('recommended')

  const state: RegisterAttendanceState = attendanceState(attendance?.status)
  const lessonById = useMemo(() => new Map(lessons.map((l) => [l.id, l])), [lessons])
  // The same history-derived lesson shown in LessonsToday, with the stored
  // current lesson used only when progression has no applicable history.
  const storedLesson = student.current_lesson_id ? lessonById.get(student.current_lesson_id) ?? null : null
  const recommendedLesson = sessionRecommendedLesson(expectedLesson, storedLesson)
  const currentLevelId = recommendedLesson?.level_id ?? student.current_level_id
  const currentLevel = levels.find((l) => l.id === currentLevelId) ?? null
  const lessonsInLevel = useMemo(
    () => lessons.filter((l) => l.level_id === currentLevelId && l.lesson_kind === 'normal').sort((a, b) => a.lesson_number - b.lesson_number),
    [lessons, currentLevelId],
  )
  const defaultLessonId = recommendedLesson?.id ?? (expectedLesson === undefined ? lessonsInLevel[0]?.id ?? '' : '')

  const showBlankFormAutomatically = state === 'attended' && sessionsToday.length === 0 && !editingSessionId
  const formOpen = draft != null || showBlankFormAutomatically
  const activeDraft: Draft | null = draft ?? (showBlankFormAutomatically ? blankDraft(defaultLessonId) : null)

  function startDraft() {
    setDraft(blankDraft(defaultLessonId))
    setEditingSessionId(null)
    setLessonScope('recommended')
  }

  function startEdit(session: AttendedSession) {
    setEditingSessionId(session.id)
    setDraft({
      lessonId: session.actual_lesson_id,
      outcome: session.outcome,
      leftAside: session.left_aside,
      identifier: session.left_aside_identifier ?? '',
      reason: session.left_aside_reason ?? '',
      note: session.left_aside_note ?? '',
      projectId: session.project_id ?? '',
      assessmentResult: '',
      remediationPath: '',
    })
    setLessonScope('all')
  }

  async function upsertAttendance(values: Partial<Attendance> & { status: Attendance['status'] }) {
    if (!profile) {
      notify('Your profile is not loaded — cannot record who made this change.', 'error')
      return false
    }
    const { error } = await supabase.from('attendance').upsert(
      {
        student_id: student.id,
        date,
        scheduled_day: student.preferred_day ?? dayLabel,
        actual_day: dayLabel,
        instructor_id: profile.id,
        ...values,
      },
      { onConflict: 'student_id,date' },
    )
    if (error) {
      notify(error.message, 'error')
      return false
    }
    return true
  }

  async function markAttended() {
    setBusy(true)
    const ok = await upsertAttendance({ status: attendance?.status === 'Completed' ? 'Completed' : 'Arrived' })
    setBusy(false)
    if (ok) onChanged()
  }

  async function markAbsent() {
    setBusy(true)
    const ok = await upsertAttendance({ status: 'Absent', time_in: null, time_out: null })
    setBusy(false)
    if (ok) {
      notify(`${student.full_name} marked absent`, 'success')
      onChanged()
    }
  }

  async function save() {
    if (!activeDraft?.lessonId) return
    const selectedForSave = lessonById.get(activeDraft.lessonId)
    if (requiresAssessmentResult(selectedForSave)) {
      if (editingSessionId) {
        notify('Assessment lessons are recorded as new sessions. Cancel this edit and record a new session instead.', 'error')
        return
      }
      if (!activeDraft.assessmentResult) {
        notify('Choose PASS or FAIL for this assessment.', 'error')
        return
      }
      if (activeDraft.assessmentResult === 'FAIL' && plan?.status !== 'ready_for_reassessment' && !activeDraft.remediationPath) {
        notify('Choose a remediation path before recording a FAIL.', 'error')
        return
      }
    }
    const validationError = validateLeftAside(activeDraft)
    if (!requiresAssessmentResult(selectedForSave) && validationError) {
      notify(validationError, 'error')
      return
    }
    setBusy(true)
    const args = {
      in_actual_lesson_id: activeDraft.lessonId,
      in_outcome: activeDraft.outcome,
      in_left_aside: activeDraft.leftAside,
      in_left_aside_identifier: activeDraft.leftAside ? activeDraft.identifier.trim() : null,
      in_left_aside_reason: activeDraft.leftAside ? activeDraft.reason || null : null,
      in_left_aside_note: activeDraft.leftAside && activeDraft.reason === 'other' ? activeDraft.note.trim() : null,
    }
    let sessionId: string | null = null
    let error: { message: string } | null = null
    if (requiresAssessmentResult(selectedForSave)) {
      const assessmentResult = await supabase.rpc('record_assessment_lesson_session', {
        in_student_id: student.id,
        in_assessment_lesson_id: activeDraft.lessonId,
        in_date: date,
        in_result: activeDraft.assessmentResult,
        in_remediation_path: activeDraft.remediationPath || 'remediation_lessons',
      })
      sessionId = typeof assessmentResult.data === 'string' ? assessmentResult.data : null
      error = assessmentResult.error
    } else {
      const regularResult = saveOperationFor(editingSessionId) === 'update'
        ? await supabase.rpc('update_attended_session', { in_session_id: editingSessionId, ...args })
        : await supabase.rpc('record_attended_session', { in_student_id: student.id, in_date: date, ...args })
      sessionId = editingSessionId ?? (typeof regularResult.data === 'string' ? regularResult.data : null)
      error = regularResult.error
    }
    if (error) {
      setBusy(false)
      notify(error.message, 'error')
      return
    }
    const savedSessionId = sessionId
    if (savedSessionId) {
      const { error: projectError } = await supabase
        .from('attended_sessions')
        .update({ project_id: activeDraft.projectId || null })
        .eq('id', savedSessionId)
      if (projectError) {
        setBusy(false)
        notify(`Session saved, but project selection was not saved: ${projectError.message}`, 'error')
        onChanged()
        return
      }
    }
    await upsertAttendance({ status: outcomeToAttendanceStatus(activeDraft.outcome) })
    setBusy(false)
    setDraft(null)
    setEditingSessionId(null)
    notify(
      requiresAssessmentResult(selectedForSave)
        ? `${selectedForSave?.title ?? 'Assessment'}: ${activeDraft.assessmentResult} recorded for ${student.full_name}`
        : editingSessionId ? 'Session updated' : `Session recorded for ${student.full_name}`,
      'success',
    )
    onChanged()
  }

  const selectedLesson = activeDraft ? lessonById.get(activeDraft.lessonId) : null
  const editingSameLessonAsBefore =
    editingSessionId != null && sessionsToday.find((s) => s.id === editingSessionId)?.actual_lesson_id === activeDraft?.lessonId
  const completedDate = selectedLesson
    ? previouslyCompletedWarningDate(selectedLesson.level_id, selectedLesson.lesson_number, previouslyCompleted, editingSameLessonAsBefore)
    : null
  const showRepeatWarning = selectedLesson?.lesson_kind === 'normal' && !requiresAssessmentResult(selectedLesson) && completedDate != null

  const nearbyNumbers = recommendedLesson ? nearbyLessonNumbers(recommendedLesson.lesson_number, lessonsInLevel.length) : []
  const nearbyLessons = lessonsInLevel.filter((l) => nearbyNumbers.includes(l.lesson_number))
  const activeProjects = projects.filter((project) => project.status === 'active')
  const failNeedsRemediationChoice = activeDraft?.assessmentResult === 'FAIL' && plan?.status !== 'ready_for_reassessment'
  const draftProjects = activeDraft?.projectId && !activeProjects.some((project) => project.id === activeDraft.projectId)
    ? [...activeProjects, ...projects.filter((project) => project.id === activeDraft.projectId)]
    : activeProjects

  async function updateSessionProject(session: AttendedSession, projectId: string) {
    setBusy(true)
    const { error } = await supabase.from('attended_sessions').update({ project_id: projectId || null }).eq('id', session.id)
    setBusy(false)
    if (error) {
      notify(error.message, 'error')
      return
    }
    onChanged()
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Attendance state */}
      <div className="flex items-center gap-2 flex-wrap">
        <button
          className={`text-sm px-3 py-2 rounded-lg font-medium min-w-[5.5rem] ${state === 'attended' ? 'btn-primary' : 'btn-ghost'}`}
          disabled={busy}
          onClick={() => void markAttended()}
        >
          Attended
        </button>
        <button
          className={`text-sm px-3 py-2 rounded-lg font-medium min-w-[5.5rem] ${state === 'absent' ? 'bg-[color:var(--rt-red)] text-white' : 'btn-ghost'}`}
          disabled={busy}
          onClick={() => void markAbsent()}
        >
          Absent
        </button>
        {state === 'not_entered' && <span className="text-xs text-slate-400">Not entered yet</span>}
      </div>

      {/* Existing sessions for this date */}
      {sessionsToday.length > 0 && (
        <ul className="flex flex-col gap-2">
          {sessionsToday.map((s) => {
            const lesson = lessonById.get(s.actual_lesson_id)
            const fb = feedbackBySessionId.get(s.id)
            return (
              <li key={s.id} className="bg-slate-50 rounded-lg p-2.5 text-sm">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div>
                    <span className="font-medium">Session {s.session_number}</span>
                    <span className="text-slate-500"> · {lesson ? `${requiresAssessmentResult(lesson) ? 'Assessment' : 'Lesson'} ${lesson.lesson_number}: ${lesson.title}` : 'Lesson'}</span>
                    {s.outcome === 'not_finished' && <span className="badge ml-1.5">Not finished</span>}
                    {s.left_aside && <span className="badge badge-assess ml-1.5">Build {s.left_aside_identifier} left aside</span>}
                  </div>
                  <label className="flex items-center gap-1.5 text-xs text-slate-500">
                    <span>Project</span>
                    <select
                      className="p-1.5 border border-slate-200 rounded-md bg-white text-slate-700"
                      value={s.project_id ?? ''}
                      disabled={busy || editingSessionId === s.id}
                      onChange={(event) => void updateSessionProject(s, event.target.value)}
                      aria-label={`Project for session ${s.session_number}`}
                    >
                      <option value="">No project</option>
                      {projects.map((project) => (
                        <option key={project.id} value={project.id}>{project.name}{project.status === 'active' ? '' : ` (${project.status.replace('_', ' ')})`}</option>
                      ))}
                    </select>
                  </label>
                  {requiresAssessmentResult(lesson) ? (
                    <span className="badge badge-assess">{s.assessment_records?.[0]?.result ?? 'No result saved'}</span>
                  ) : (
                    <button className="text-xs text-slate-500 hover:underline" onClick={() => (editingSessionId === s.id ? setDraft(null) : startEdit(s))}>
                      {editingSessionId === s.id ? 'Cancel' : 'Edit'}
                    </button>
                  )}
                </div>
                {fb && (
                  <div className="mt-1.5">
                    <FeedbackControl feedbackId={fb.id} status={fb.status} studentName={student.full_name} onChanged={onChanged} variant="full" />
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {state === 'attended' && !formOpen && (
        <button className="btn-ghost text-sm self-start" disabled={busy} onClick={startDraft}>
          + Record {sessionsToday.length > 0 ? 'another session' : 'session details'}
        </button>
      )}

      {/* Session entry / edit form */}
      {state === 'attended' && activeDraft && (
        <div className="bg-slate-50 rounded-lg p-3 flex flex-col gap-3">
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-sm font-medium text-slate-600">Actual lesson taught</span>
              <div className="flex gap-1 text-xs">
                {(['recommended', 'nearby', 'all'] as const).map((scope) => (
                  <button
                    key={scope}
                    className={`px-2 py-1 rounded-full ${lessonScope === scope ? 'bg-[color:var(--rt-blue)] text-white' : 'bg-white border border-slate-200 text-slate-500'}`}
                    onClick={() => setLessonScope(scope)}
                  >
                    {scope === 'recommended' ? 'Recommended' : scope === 'nearby' ? 'Nearby' : 'All lessons'}
                  </button>
                ))}
              </div>
            </div>

            {draftProjects.length > 0 && (
              <label className="block mb-2 text-sm">
                <span className="block text-xs text-slate-500 mb-1">Project worked on in this session</span>
                <select
                  className="w-full p-2 border border-slate-200 rounded-lg text-sm bg-white"
                  value={activeDraft.projectId}
                  onChange={(event) => setDraft({ ...activeDraft, projectId: event.target.value })}
                >
                  <option value="">No project</option>
                  {draftProjects.map((project) => <option key={project.id} value={project.id}>{project.name}{project.status === 'active' ? '' : ` (${project.status.replace('_', ' ')})`}</option>)}
                </select>
              </label>
            )}

            {lessonScope === 'recommended' && recommendedLesson && (
              <button
                className={`w-full text-left p-2.5 rounded-lg border text-sm ${activeDraft.lessonId === recommendedLesson.id ? 'border-[color:var(--rt-blue)] bg-[color:var(--rt-blue-tint)]' : 'border-slate-200 bg-white'}`}
                onClick={() => setDraft({ ...activeDraft, lessonId: recommendedLesson.id, assessmentResult: '', remediationPath: '' })}
              >
                {requiresAssessmentResult(recommendedLesson) ? 'Assessment' : 'Lesson'} {recommendedLesson.lesson_number}: {recommendedLesson.title}
                <span className="block text-xs text-slate-500">Student's current expected lesson</span>
              </button>
            )}

            {lessonScope === 'recommended' && !recommendedLesson && expectedLesson === null && (
              <p className="text-xs text-slate-500">No next curriculum lesson is available from the recorded history. Choose All lessons to record a catch-up or correction.</p>
            )}

            {lessonScope === 'nearby' && (
              <div className="grid grid-cols-1 gap-1.5">
                {nearbyLessons.map((l) => (
                  <button
                    key={l.id}
                    className={`w-full text-left p-2 rounded-lg border text-sm ${activeDraft.lessonId === l.id ? 'border-[color:var(--rt-blue)] bg-[color:var(--rt-blue-tint)]' : 'border-slate-200 bg-white'}`}
                    onClick={() => setDraft({ ...activeDraft, lessonId: l.id, assessmentResult: '', remediationPath: '' })}
                  >
                    {requiresAssessmentResult(l) ? 'Assessment' : 'Lesson'} {l.lesson_number}: {l.title}
                  </button>
                ))}
              </div>
            )}

            {lessonScope === 'all' && (
              <select
                className="w-full p-2 border border-slate-200 rounded-lg text-sm bg-white"
                value={activeDraft.lessonId}
                onChange={(e) => setDraft({
                  ...activeDraft,
                  lessonId: e.target.value,
                  assessmentResult: e.target.value === activeDraft.lessonId ? activeDraft.assessmentResult : '',
                  remediationPath: e.target.value === activeDraft.lessonId ? activeDraft.remediationPath : '',
                })}
                aria-label="Choose any lesson"
              >
                <optgroup label={currentLevel ? levelLabel(currentLevel) : 'Current level'}>
                  {lessonsInLevel.filter((l) => !requiresAssessmentResult(l)).map((l) => (
                    <option key={l.id} value={l.id}>Lesson {l.lesson_number}: {l.title}</option>
                  ))}
                </optgroup>
                {Object.entries(
                  lessons
                    .filter((l) => l.lesson_kind === 'normal' && !requiresAssessmentResult(l) && l.level_id !== currentLevelId)
                    .reduce<Record<string, Lesson[]>>((acc, l) => {
                      const lvl = levels.find((lv) => lv.id === l.level_id)
                      const key = lvl ? levelLabel(lvl) : 'Other'
                      acc[key] = [...(acc[key] ?? []), l]
                      return acc
                    }, {}),
                ).map(([label, ls]) => (
                  <optgroup key={label} label={label}>
                    {ls
                      .sort((a, b) => a.lesson_number - b.lesson_number)
                      .map((l) => (
                        <option key={l.id} value={l.id}>Lesson {l.lesson_number}: {l.title}</option>
                      ))}
                  </optgroup>
                ))}
                {Object.entries(
                  lessons
                    .filter((l) => requiresAssessmentResult(l))
                    .reduce<Record<string, Lesson[]>>((acc, l) => {
                      const lvl = levels.find((lv) => lv.id === l.level_id)
                      const key = lvl ? levelLabel(lvl) : 'Other'
                      acc[key] = [...(acc[key] ?? []), l]
                      return acc
                    }, {}),
                ).map(([label, ls]) => (
                  <optgroup key={`assessment-${label}`} label={`${label} — Assessments`}>
                    {ls
                      .sort((a, b) => a.lesson_number - b.lesson_number)
                      .map((l) => (
                        <option key={l.id} value={l.id}>Assessment {l.lesson_number}: {l.title}</option>
                      ))}
                  </optgroup>
                ))}
              </select>
            )}

            {requiresAssessmentResult(selectedLesson) && (
              <div className="mt-2 rounded-lg border border-sky-200 bg-sky-50 p-3">
                <span className="block text-sm font-medium text-sky-900 mb-2">Assessment result required</span>
                <div className="flex gap-2">
                  {(['PASS', 'FAIL'] as const).map((result) => (
                    <button
                      key={result}
                      className={`flex-1 text-sm px-3 py-2 rounded-lg font-medium ${activeDraft.assessmentResult === result ? result === 'PASS' ? 'btn-primary' : 'bg-rose-600 text-white' : 'btn-ghost'}`}
                      onClick={() => setDraft({ ...activeDraft, assessmentResult: result, remediationPath: result === 'PASS' ? '' : activeDraft.remediationPath })}
                    >
                      {result}
                    </button>
                  ))}
                </div>
                {failNeedsRemediationChoice && (
                  <fieldset className="mt-3">
                    <legend className="text-xs text-sky-900 mb-1">Remediation path (required before saving):</legend>
                    <div className="flex flex-col gap-1.5">
                      {REMEDIATION_PATH_OPTIONS.map((option) => (
                        <label key={option.value} className="flex items-start gap-1.5 text-xs text-sky-900">
                          <input
                            type="radio"
                            name={`assessment-remediation-${student.id}`}
                            className="mt-0.5"
                            checked={activeDraft.remediationPath === option.value}
                            onChange={() => setDraft({ ...activeDraft, remediationPath: option.value })}
                          />
                          <span>{option.label}</span>
                        </label>
                      ))}
                    </div>
                  </fieldset>
                )}
              </div>
            )}

            {showRepeatWarning && selectedLesson && completedDate && (
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2 mt-2">
                This student previously completed Lesson {selectedLesson.lesson_number} on {completedDate}. Recording this session will count it as a repeat.
              </p>
            )}
          </div>

          {!requiresAssessmentResult(selectedLesson) && <div>
            <span className="block text-sm font-medium text-slate-600 mb-1.5">Outcome</span>
            <div className="flex gap-2">
              <button
                className={`flex-1 text-sm px-3 py-2 rounded-lg font-medium ${activeDraft.outcome === 'completed' ? 'btn-primary' : 'btn-ghost'}`}
                onClick={() => setDraft({ ...activeDraft, outcome: 'completed' })}
              >
                Completed
              </button>
              <button
                className={`flex-1 text-sm px-3 py-2 rounded-lg font-medium ${activeDraft.outcome === 'not_finished' ? 'bg-[color:var(--rt-yellow)] text-[color:var(--rt-ink)]' : 'btn-ghost'}`}
                onClick={() => setDraft({ ...activeDraft, outcome: 'not_finished' })}
              >
                Not Finished
              </button>
            </div>
          </div>}

          {!requiresAssessmentResult(selectedLesson) && activeDraft.outcome === 'not_finished' && (
            <div className="bg-white rounded-lg border border-slate-200 p-2.5">
              <label className="flex items-center gap-2 text-sm mb-2">
                <input
                  type="checkbox"
                  checked={activeDraft.leftAside}
                  onChange={(e) => setDraft({ ...activeDraft, leftAside: e.target.checked })}
                />
                Build/laptop left aside to finish later
              </label>
              {activeDraft.leftAside && (
                <div className="flex flex-col gap-2">
                  <label className="text-sm block">
                    <span className="block text-slate-500 mb-1">Identifier</span>
                    <input
                      type="text"
                      placeholder="e.g. B12, Laptop 7, 23"
                      className="w-full p-2 border border-slate-200 rounded-lg text-sm"
                      value={activeDraft.identifier}
                      onChange={(e) => setDraft({ ...activeDraft, identifier: e.target.value })}
                    />
                  </label>
                  <label className="text-sm block">
                    <span className="block text-slate-500 mb-1">Reason</span>
                    <select
                      className="w-full p-2 border border-slate-200 rounded-lg text-sm"
                      value={activeDraft.reason}
                      onChange={(e) => setDraft({ ...activeDraft, reason: e.target.value as LeftAsideReason })}
                    >
                      <option value="">— Choose —</option>
                      {NOT_FINISHED_REASONS.map((r) => (
                        <option key={r.value} value={r.value}>{r.label}</option>
                      ))}
                    </select>
                  </label>
                  {activeDraft.reason === 'other' && (
                    <label className="text-sm block">
                      <span className="block text-slate-500 mb-1">Note</span>
                      <input
                        type="text"
                        className="w-full p-2 border border-slate-200 rounded-lg text-sm"
                        value={activeDraft.note}
                        onChange={(e) => setDraft({ ...activeDraft, note: e.target.value })}
                      />
                    </label>
                  )}
                </div>
              )}
            </div>
          )}

          <div className="flex justify-end gap-2">
            <button
              className="btn-ghost text-sm"
              disabled={busy}
              onClick={() => {
                setDraft(null)
                setEditingSessionId(null)
              }}
            >
              Cancel
            </button>
            <BusyButton busy={busy} disabled={!activeDraft.lessonId} onClick={() => void save()} className="btn-primary text-sm">
              Save
            </BusyButton>
          </div>
        </div>
      )}
    </div>
  )
}
