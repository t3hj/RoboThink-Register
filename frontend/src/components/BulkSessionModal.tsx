import { useMemo, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useToast } from './Toast'
import { BusyButton } from './ui'
import { levelLabel } from '../lib/curriculum'
import { NOT_FINISHED_REASONS, nearbyLessonNumbers, validateLeftAside } from '../lib/attendedSessionsUi'
import { eligibleForSession, mostCommonLessonId, summarizeBulkResults, type BulkCandidate } from '../lib/bulkActions'
import type { Lesson, LeftAsideReason, Level, SessionOutcome } from '../types'

interface SessionCandidate extends BulkCandidate {
  currentLessonId: string | null
  currentLevelId: number | null
}

interface Props {
  mode: 'lesson_outcome' | 'not_finished'
  candidates: SessionCandidate[]
  date: string
  levels: Level[]
  lessons: Lesson[]
  onDone: () => void
  onClose: () => void
}

/** Bulk-records a brand-new session (never edits an existing one, exactly
 *  like the individual workflow's "Record another session") for every
 *  eligible (Attended) selected student, using a shared lesson + outcome —
 *  but, for Not Finished, each student's own "left aside" identifier,
 *  since that must never be forced to match another student's. */
export default function BulkSessionModal({ mode, candidates, date, levels, lessons, onDone, onClose }: Props) {
  const { notify } = useToast()
  const [busy, setBusy] = useState(false)
  const [step, setStep] = useState<'configure' | 'review'>('configure')
  const [lessonScope, setLessonScope] = useState<'recommended' | 'nearby' | 'all'>('recommended')
  const [outcome, setOutcome] = useState<SessionOutcome>(mode === 'not_finished' ? 'not_finished' : 'completed')
  const [reason, setReason] = useState<LeftAsideReason | ''>('')
  const [note, setNote] = useState('')
  const [perStudent, setPerStudent] = useState<Map<string, { leftAside: boolean; identifier: string }>>(new Map())

  const { eligible, skipped } = eligibleForSession(candidates)

  const recommendedId = useMemo(() => mostCommonLessonId(eligible.map((c) => c.currentLessonId)), [eligible])
  const referenceLevelId = useMemo(() => {
    const lesson = lessons.find((l) => l.id === recommendedId)
    return lesson?.level_id ?? eligible[0]?.currentLevelId ?? null
  }, [recommendedId, lessons, eligible])
  const referenceLevel = levels.find((l) => l.id === referenceLevelId) ?? null
  const lessonsInLevel = useMemo(
    () => lessons.filter((l) => l.level_id === referenceLevelId && l.lesson_kind === 'normal').sort((a, b) => a.lesson_number - b.lesson_number),
    [lessons, referenceLevelId],
  )
  const recommendedLesson = lessons.find((l) => l.id === recommendedId) ?? null
  const nearbyNumbers = recommendedLesson ? nearbyLessonNumbers(recommendedLesson.lesson_number, lessonsInLevel.length) : []
  const nearbyLessons = lessonsInLevel.filter((l) => nearbyNumbers.includes(l.lesson_number))

  const [lessonId, setLessonId] = useState<string>(recommendedId ?? '')
  const selectedLesson = lessons.find((l) => l.id === lessonId) ?? null

  function studentLeftAside(id: string) {
    return perStudent.get(id) ?? { leftAside: false, identifier: '' }
  }
  function setStudentLeftAside(id: string, patch: Partial<{ leftAside: boolean; identifier: string }>) {
    const next = new Map(perStudent)
    next.set(id, { ...studentLeftAside(id), ...patch })
    setPerStudent(next)
  }

  function goToReview() {
    if (!lessonId) {
      notify('Choose a lesson first.', 'error')
      return
    }
    if (outcome === 'not_finished') {
      for (const c of eligible) {
        const la = studentLeftAside(c.id)
        const err = validateLeftAside({ leftAside: la.leftAside, identifier: la.identifier, reason, note })
        if (err) {
          notify(`${c.full_name}: ${err}`, 'error')
          return
        }
      }
    }
    setStep('review')
  }

  async function apply() {
    setBusy(true)
    const results = await Promise.allSettled(
      eligible.map((c) => {
        const la = outcome === 'not_finished' ? studentLeftAside(c.id) : { leftAside: false, identifier: '' }
        return supabase
          .rpc('record_attended_session', {
            in_student_id: c.id,
            in_date: date,
            in_actual_lesson_id: lessonId,
            in_outcome: outcome,
            in_left_aside: la.leftAside,
            in_left_aside_identifier: la.leftAside ? la.identifier.trim() : null,
            in_left_aside_reason: la.leftAside ? reason || null : null,
            in_left_aside_note: la.leftAside && reason === 'other' ? note.trim() : null,
          })
          .then(({ error }) => {
            if (error) throw error
          })
      }),
    )
    setBusy(false)
    const summary = summarizeBulkResults(
      eligible.map((c) => ({ id: c.id, name: c.full_name })),
      results,
    )
    if (summary.failed.length === 0) {
      notify(`Session recorded for ${summary.succeeded.length} student${summary.succeeded.length === 1 ? '' : 's'}`, 'success')
    } else {
      notify(`${summary.succeeded.length} recorded, ${summary.failed.length} failed: ${summary.failed.map((f) => f.name).join(', ')}`, 'error')
    }
    onDone()
  }

  const title = mode === 'not_finished' ? 'Bulk Not Finished' : 'Bulk Lesson / Outcome'

  return (
    <div className="fixed inset-0 z-40 flex items-start sm:items-center justify-center bg-black/40 p-4 overflow-y-auto" onClick={onClose}>
      <div className="card p-5 max-w-lg w-full my-8" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={title}>
        <h3 className="font-semibold mb-1">{title}</h3>
        <p className="text-xs text-slate-500 mb-3">
          Records a new session for each Attended student selected — existing sessions are never edited by this.
        </p>

        {step === 'configure' && (
          <div className="flex flex-col gap-3">
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
              {lessonScope === 'recommended' && recommendedLesson && (
                <button
                  className={`w-full text-left p-2.5 rounded-lg border text-sm ${lessonId === recommendedLesson.id ? 'border-[color:var(--rt-blue)] bg-[color:var(--rt-blue-tint)]' : 'border-slate-200 bg-white'}`}
                  onClick={() => setLessonId(recommendedLesson.id)}
                >
                  Lesson {recommendedLesson.lesson_number}: {recommendedLesson.title}
                  <span className="block text-xs text-slate-500">Most common current lesson among selected students</span>
                </button>
              )}
              {lessonScope === 'nearby' && (
                <div className="grid grid-cols-1 gap-1.5">
                  {nearbyLessons.map((l) => (
                    <button
                      key={l.id}
                      className={`w-full text-left p-2 rounded-lg border text-sm ${lessonId === l.id ? 'border-[color:var(--rt-blue)] bg-[color:var(--rt-blue-tint)]' : 'border-slate-200 bg-white'}`}
                      onClick={() => setLessonId(l.id)}
                    >
                      Lesson {l.lesson_number}: {l.title}
                    </button>
                  ))}
                </div>
              )}
              {lessonScope === 'all' && (
                <select className="w-full p-2 border border-slate-200 rounded-lg text-sm bg-white" value={lessonId} onChange={(e) => setLessonId(e.target.value)}>
                  <optgroup label={referenceLevel ? levelLabel(referenceLevel) : 'Level'}>
                    {lessonsInLevel.map((l) => (
                      <option key={l.id} value={l.id}>Lesson {l.lesson_number}: {l.title}</option>
                    ))}
                  </optgroup>
                </select>
              )}
            </div>

            {mode === 'lesson_outcome' && (
              <div>
                <span className="block text-sm font-medium text-slate-600 mb-1.5">Outcome</span>
                <div className="flex gap-2">
                  <button className={`flex-1 text-sm px-3 py-2 rounded-lg font-medium ${outcome === 'completed' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setOutcome('completed')}>
                    Completed
                  </button>
                  <button className={`flex-1 text-sm px-3 py-2 rounded-lg font-medium ${outcome === 'not_finished' ? 'bg-[color:var(--rt-yellow)] text-[color:var(--rt-ink)]' : 'btn-ghost'}`} onClick={() => setOutcome('not_finished')}>
                    Not Finished
                  </button>
                </div>
              </div>
            )}

            {outcome === 'not_finished' && (
              <div className="bg-slate-50 rounded-lg p-2.5">
                <label className="text-sm block mb-2">
                  <span className="block text-slate-500 mb-1">Reason (applies to anyone left aside below)</span>
                  <select className="w-full p-2 border border-slate-200 rounded-lg text-sm" value={reason} onChange={(e) => setReason(e.target.value as LeftAsideReason)}>
                    <option value="">— Choose —</option>
                    {NOT_FINISHED_REASONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                  </select>
                </label>
                {reason === 'other' && (
                  <label className="text-sm block mb-2">
                    <span className="block text-slate-500 mb-1">Note</span>
                    <input type="text" className="w-full p-2 border border-slate-200 rounded-lg text-sm" value={note} onChange={(e) => setNote(e.target.value)} />
                  </label>
                )}
                <div className="text-xs text-slate-500 mb-1.5">Build/laptop left aside — set individually per student:</div>
                <ul className="flex flex-col gap-1.5 max-h-48 overflow-y-auto">
                  {eligible.map((c) => {
                    const la = studentLeftAside(c.id)
                    return (
                      <li key={c.id} className="flex items-center gap-2 bg-white rounded-lg border border-slate-200 p-2">
                        <label className="flex items-center gap-1.5 text-sm flex-1">
                          <input type="checkbox" checked={la.leftAside} onChange={(e) => setStudentLeftAside(c.id, { leftAside: e.target.checked })} />
                          {c.full_name}
                        </label>
                        {la.leftAside && (
                          <input
                            type="text"
                            placeholder="e.g. B12"
                            className="w-28 p-1.5 border border-slate-200 rounded text-sm"
                            value={la.identifier}
                            onChange={(e) => setStudentLeftAside(c.id, { identifier: e.target.value })}
                          />
                        )}
                      </li>
                    )
                  })}
                </ul>
              </div>
            )}

            {selectedLesson && (
              <p className="text-xs text-slate-500">Selected: Lesson {selectedLesson.lesson_number}: {selectedLesson.title}</p>
            )}
          </div>
        )}

        {step === 'review' && (
          <div className="flex flex-col gap-3">
            <p className="text-sm">Apply to {candidates.length} student{candidates.length === 1 ? '' : 's'}?</p>
            {eligible.length > 0 && (
              <div>
                <div className="text-sm font-medium mb-1">{eligible.length} will get a new session</div>
                <ul className="text-sm text-slate-600 max-h-40 overflow-y-auto">
                  {eligible.map((c) => {
                    const la = outcome === 'not_finished' ? studentLeftAside(c.id) : null
                    return (
                      <li key={c.id}>
                        {c.full_name}
                        {la?.leftAside && <span className="text-slate-400"> — build {la.identifier} left aside</span>}
                      </li>
                    )
                  })}
                </ul>
              </div>
            )}
            {skipped.length > 0 && (
              <div>
                <div className="text-sm font-medium mb-1">{skipped.length} will be skipped</div>
                <ul className="text-sm text-slate-500 max-h-32 overflow-y-auto">
                  {skipped.map(({ candidate, reason: r }) => <li key={candidate.id}>{candidate.full_name} — {r}</li>)}
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
            <button className="btn-primary" disabled={eligible.length === 0} onClick={goToReview}>
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
