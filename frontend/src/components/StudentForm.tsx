import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useToast } from './Toast'
import { BusyButton } from './ui'
import LevelLessonPicker from './LevelLessonPicker'
import { loadCurriculum } from '../lib/curriculumData'
import { todayISO } from '../lib/dates'
import { useCentres } from '../lib/centres'
import { useBrand } from '../lib/brand'
import SessionSlotsEditor, { initialSlots, validSlots, type SlotInput } from './SessionSlotsEditor'
import type { Level, Lesson, Student, StudentRequestPayload, Subscription } from '../types'
import { ModalOverlay } from './ui'

interface Props {
  student?: Student | null
  /** Pre-fills a new student from an approved request. */
  prefill?: { payload: StudentRequestPayload; centreId: string } | null
  onClose: () => void
  onSaved: (saved?: { id: string }) => void
}

/** Create/edit modal. Minimum info needed to actually run the register:
 *  name, subscription, level, day/time, and (on create) a starting lesson.
 *  Date of birth and parent/contact details are NOT part of this workflow —
 *  RoboThink Register doesn't need them. Existing historical values are
 *  left untouched in the database; this form simply never asks for or
 *  shows them, on create or edit. */
export default function StudentForm({ student, prefill, onClose, onSaved }: Props) {
  const { notify } = useToast()
  const { activeCentres, selectedCentreId } = useCentres()
  const { activeBrand } = useBrand()
  const isEdit = Boolean(student)

  const [fullName, setFullName] = useState(student?.full_name ?? prefill?.payload.full_name ?? '')
  const [joined, setJoined] = useState(student?.date_joined ?? todayISO())
  const [slots, setSlots] = useState<SlotInput[]>(() =>
    prefill && prefill.payload.slots.length > 0 ? prefill.payload.slots.map((x) => ({ day: x.day, time: x.time })) : initialSlots(student),
  )
  const [pattern, setPattern] = useState<'weekly' | 'fortnightly'>(
    (student?.attendance_pattern ?? prefill?.payload.attendance_pattern) === 'fortnightly' ? 'fortnightly' : 'weekly',
  )
  const [anchor, setAnchor] = useState(student?.fortnight_anchor ?? prefill?.payload.fortnight_anchor ?? '')
  // Only send the fortnightly columns once the database has them (an edited
  // student already carries them) or when fortnightly is actually chosen, so
  // the form keeps working before the migration is applied.
  const patternColumns = student?.attendance_pattern !== undefined || pattern === 'fortnightly'
    ? { attendance_pattern: pattern, fortnight_anchor: pattern === 'fortnightly' ? anchor || null : null }
    : {}
  const [subscriptionId, setSubscriptionId] = useState<number | ''>(student?.subscription_id ?? prefill?.payload.subscription_id ?? '')
  const [notes, setNotes] = useState(student?.notes ?? prefill?.payload.notes ?? '')
  const [active, setActive] = useState(student?.active ?? true)
  const [centreId, setCentreId] = useState<string | null>(student?.centre_id ?? prefill?.centreId ?? selectedCentreId)

  const [subscriptions, setSubscriptions] = useState<Subscription[]>([])
  const [levels, setLevels] = useState<Level[]>([])
  const [lessons, setLessons] = useState<Lesson[]>([])
  const [levelId, setLevelId] = useState<number | null>(student?.current_level_id ?? null)
  const [lessonNumber, setLessonNumber] = useState<number | null>(1)
  const [busy, setBusy] = useState(false)
  const [loadingCurriculum, setLoadingCurriculum] = useState(true)

  useEffect(() => {
    if (!isEdit && !centreId && selectedCentreId) setCentreId(selectedCentreId)
  }, [centreId, isEdit, selectedCentreId])

  useEffect(() => {
    let cancelled = false
    async function load() {
      const [{ levels: lv, lessons: le }, subsRes] = await Promise.all([
        loadCurriculum(),
        supabase.from('subscriptions').select('*').order('id'),
      ])
      if (cancelled) return
      setLevels(lv)
      setLessons(le)
      setSubscriptions((subsRes.data ?? []) as Subscription[])
      if (!isEdit && !levelId && lv.length) setLevelId(lv[0].id)
      setLoadingCurriculum(false)
    }
    void load()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function save() {
    if (!fullName.trim()) {
      notify('Full name is required.', 'error')
      return
    }
    const sessions = validSlots(slots)
    if (slots.some((x) => (x.day && !x.time) || (!x.day && x.time))) {
      notify('Each session needs both a day and a time.', 'error')
      return
    }
    if (pattern === 'fortnightly' && (sessions.length === 0 || !anchor)) {
      notify('A fortnightly student needs at least one session and an "on" week date.', 'error')
      return
    }
    const primary = sessions[0]
    setBusy(true)
    if (isEdit && student) {
      const { error } = await supabase
        .from('students')
        .update({
          full_name: fullName.trim(),
          date_joined: joined || null,
          preferred_day: primary?.day ?? null,
          preferred_time: primary?.time ?? null,
          ...patternColumns,
          subscription_id: subscriptionId === '' ? null : subscriptionId,
          notes: notes || null,
          active,
        })
        .eq('id', student.id)
      if (error) {
        setBusy(false)
        notify(error.message, 'error')
        return
      }
      const syncError = await syncSessions(student.id, sessions)
      setBusy(false)
      if (syncError) notify(`Details saved, but the sessions could not be updated: ${syncError}`, 'error')
      else notify('Student updated', 'success')
      onSaved({ id: student.id })
      return
    }

    // Create: resolve the chosen (levelId, lessonNumber) to a real lesson id.
    const lesson = lessons.find((l) => l.level_id === levelId && l.lesson_number === lessonNumber)
    if (!levelId || !lesson) {
      setBusy(false)
      notify('Choose a level and starting lesson.', 'error')
      return
    }
    if (subscriptionId === '') {
      setBusy(false)
      notify('Choose a subscription type.', 'error')
      return
    }
    if (!centreId) {
      setBusy(false)
      notify('Choose a centre.', 'error')
      return
    }
    const { data: created, error } = await supabase.from('students').insert({
      full_name: fullName.trim(),
      brand: activeBrand,
      date_joined: joined || null,
      preferred_day: primary?.day ?? null,
      preferred_time: primary?.time ?? null,
      ...patternColumns,
      subscription_id: subscriptionId,
      current_level_id: levelId,
      current_lesson_id: lesson.id,
      centre_id: centreId,
      active: true,
    }).select('id').single()
    if (error || !created) {
      setBusy(false)
      notify(error?.message ?? 'Could not add the student.', 'error')
      return
    }
    const syncError = await syncSessions(created.id as string, sessions)
    setBusy(false)
    if (syncError) notify(`${fullName.trim()} was added, but the sessions could not be saved: ${syncError}`, 'error')
    else notify(`${fullName.trim()} added`, 'success')
    onSaved({ id: created.id as string })
  }

  /** Replaces the student's schedule rows with the sessions in the form.
   *  Returns an error message, or null on success. */
  async function syncSessions(studentId: string, sessions: SlotInput[]): Promise<string | null> {
    const del = await supabase.from('student_schedules').delete().eq('student_id', studentId)
    if (del.error) return del.error.message
    if (sessions.length === 0) return null
    const ins = await supabase.from('student_schedules').insert(
      sessions.map((x) => ({
        student_id: studentId,
        day_of_week: x.day,
        start_time: x.time,
        week_pattern: pattern === 'fortnightly' ? 'A' : 'EVERY_WEEK',
        active: true,
      })),
    )
    return ins.error?.message ?? null
  }

  return (
    <ModalOverlay className="flex items-start sm:items-center justify-center bg-black/40 p-2 sm:p-4 overflow-y-auto overscroll-contain" onClose={onClose} dismissible={!busy}>
      <div className="card p-4 sm:p-5 max-w-lg w-full max-h-[calc(100dvh-1rem)] sm:max-h-[calc(100dvh-2rem)] overflow-y-auto overscroll-contain my-2 sm:my-8" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={isEdit ? 'Edit student' : 'Add student'}>
        <h3 className="font-semibold mb-4">{isEdit ? 'Edit student' : 'Add student'}</h3>

        <div className="space-y-3">
          <label className="text-sm block">
            <span className="block text-slate-600 mb-1">Student name</span>
            <input className="w-full p-2 border border-slate-200 rounded-lg text-sm" value={fullName} onChange={(e) => setFullName(e.target.value)} disabled={busy} autoFocus />
          </label>

          <label className="text-sm block">
            <span className="block text-slate-600 mb-1">Subscription</span>
            <select
              className="w-full p-2 border border-slate-200 rounded-lg text-sm"
              value={subscriptionId}
              onChange={(e) => setSubscriptionId(e.target.value ? Number(e.target.value) : '')}
              disabled={busy}
            >
              <option value="">— Choose —</option>
              {subscriptions.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </label>

          <label className="text-sm block">
            <span className="block text-slate-600 mb-1">Centre</span>
            {isEdit ? (
              <div className="p-2 bg-slate-50 rounded-lg text-slate-700">{student?.centres?.name ?? 'Centre unavailable'}</div>
            ) : (
              <select
                className="w-full p-2 border border-slate-200 rounded-lg text-sm"
                value={centreId ?? ''}
                onChange={(e) => setCentreId(e.target.value || null)}
                disabled={busy}
                required
              >
                <option value="">— Choose a centre —</option>
                {activeCentres.map((centre) => (
                  <option key={centre.id} value={centre.id}>{centre.name}</option>
                ))}
              </select>
            )}
          </label>

          <SessionSlotsEditor slots={slots} onChange={setSlots} disabled={busy} />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="text-sm block">
              <span className="block text-slate-600 mb-1">How often</span>
              <select
                className="w-full p-2 border border-slate-200 rounded-lg text-sm"
                value={pattern}
                onChange={(e) => {
                  const next = e.target.value as 'weekly' | 'fortnightly'
                  setPattern(next)
                  if (next === 'fortnightly' && !anchor) setAnchor(todayISO())
                }}
                disabled={busy}
              >
                <option value="weekly">Every week</option>
                <option value="fortnightly">Every other week</option>
              </select>
            </label>
            {pattern === 'fortnightly' && (
              <label className="text-sm block">
                <span className="block text-slate-600 mb-1">A week they attend (any date in it)</span>
                <input type="date" className="w-full p-2 border border-slate-200 rounded-lg text-sm" value={anchor} onChange={(e) => setAnchor(e.target.value)} disabled={busy} />
              </label>
            )}
          </div>
          {pattern === 'fortnightly' && (
            <p className="text-xs text-slate-600 -mt-1">
              They show on the register every second week from that date and are not counted absent in their off weeks.
              If they come for two sessions in their on week, add both under Weekly sessions.
            </p>
          )}

          <label className="text-sm block">
            <span className="block text-slate-600 mb-1">Date joined</span>
            <input type="date" className="w-full p-2 border border-slate-200 rounded-lg text-sm" value={joined} onChange={(e) => setJoined(e.target.value)} disabled={busy} />
          </label>

          <div>
            <span className="block text-slate-600 text-sm mb-1">{isEdit ? 'Level' : 'Level & starting lesson'}</span>
            {loadingCurriculum ? (
              <div className="text-sm text-slate-600">Loading curriculum…</div>
            ) : isEdit ? (
              <div className="text-sm text-slate-600 bg-slate-50 rounded-lg p-2">
                Use "Change current lesson" on the student's page to move them — this form only sets the level on creation.
              </div>
            ) : (
              <LevelLessonPicker
                levels={levels}
                lessons={lessons}
                levelId={levelId}
                lessonNumber={lessonNumber}
                onChange={(lv, ln) => {
                  setLevelId(lv)
                  setLessonNumber(ln)
                }}
                disabled={busy}
              />
            )}
          </div>

          <label className="text-sm block">
            <span className="block text-slate-600 mb-1">Notes <span className="text-slate-600">(optional)</span></span>
            <textarea className="w-full p-2 border border-slate-200 rounded-lg text-sm" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} disabled={busy} />
          </label>

          {isEdit && (
            <label className="text-sm flex items-center gap-2">
              <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} disabled={busy} />
              Active
            </label>
          )}
        </div>

        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 mt-5">
          <button className="btn-ghost w-full sm:w-auto" onClick={onClose} disabled={busy}>Cancel</button>
          <BusyButton busy={busy} className="btn-primary w-full sm:w-auto" onClick={() => void save()}>{isEdit ? 'Save changes' : 'Add student'}</BusyButton>
        </div>
      </div>
    </ModalOverlay>
  )
}
