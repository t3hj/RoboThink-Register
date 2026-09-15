import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useToast } from './Toast'
import { BusyButton } from './ui'
import LevelLessonPicker from './LevelLessonPicker'
import { loadCurriculum } from '../lib/curriculumData'
import { todayISO } from '../lib/dates'
import type { Level, Lesson, Student, Subscription } from '../types'

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

interface Props {
  student?: Student | null
  onClose: () => void
  onSaved: () => void
}

/** Create/edit modal. Minimum info needed to actually run the register:
 *  name, subscription, level, day/time, and (on create) a starting lesson.
 *  Date of birth and parent/contact details are NOT part of this workflow —
 *  RoboThink Register doesn't need them. Existing historical values are
 *  left untouched in the database; this form simply never asks for or
 *  shows them, on create or edit. */
export default function StudentForm({ student, onClose, onSaved }: Props) {
  const { notify } = useToast()
  const isEdit = Boolean(student)

  const [fullName, setFullName] = useState(student?.full_name ?? '')
  const [joined, setJoined] = useState(student?.date_joined ?? todayISO())
  const [preferredDay, setPreferredDay] = useState(student?.preferred_day ?? '')
  const [preferredTime, setPreferredTime] = useState(student?.preferred_time ?? '')
  const [subscriptionId, setSubscriptionId] = useState<number | ''>(student?.subscription_id ?? '')
  const [notes, setNotes] = useState(student?.notes ?? '')
  const [active, setActive] = useState(student?.active ?? true)

  const [subscriptions, setSubscriptions] = useState<Subscription[]>([])
  const [levels, setLevels] = useState<Level[]>([])
  const [lessons, setLessons] = useState<Lesson[]>([])
  const [levelId, setLevelId] = useState<number | null>(student?.current_level_id ?? null)
  const [lessonNumber, setLessonNumber] = useState<number | null>(1)
  const [busy, setBusy] = useState(false)
  const [loadingCurriculum, setLoadingCurriculum] = useState(true)

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
    setBusy(true)
    if (isEdit && student) {
      const { error } = await supabase
        .from('students')
        .update({
          full_name: fullName.trim(),
          date_joined: joined || null,
          preferred_day: preferredDay || null,
          preferred_time: preferredTime || null,
          subscription_id: subscriptionId === '' ? null : subscriptionId,
          notes: notes || null,
          active,
        })
        .eq('id', student.id)
      setBusy(false)
      if (error) {
        notify(error.message, 'error')
        return
      }
      notify('Student updated', 'success')
      onSaved()
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
    const { error } = await supabase.from('students').insert({
      full_name: fullName.trim(),
      date_joined: joined || null,
      preferred_day: preferredDay || null,
      preferred_time: preferredTime || null,
      subscription_id: subscriptionId,
      current_level_id: levelId,
      current_lesson_id: lesson.id,
      active: true,
    })
    setBusy(false)
    if (error) {
      notify(error.message, 'error')
      return
    }
    notify(`${fullName.trim()} added`, 'success')
    onSaved()
  }

  return (
    <div className="fixed inset-0 z-40 flex items-start sm:items-center justify-center bg-black/40 p-4 overflow-y-auto" onClick={onClose}>
      <div className="card p-5 max-w-lg w-full my-8" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={isEdit ? 'Edit student' : 'Add student'}>
        <h3 className="font-semibold mb-4">{isEdit ? 'Edit student' : 'Add student'}</h3>

        <div className="space-y-3">
          <label className="text-sm block">
            <span className="block text-slate-500 mb-1">Student name</span>
            <input className="w-full p-2 border border-slate-200 rounded-lg text-sm" value={fullName} onChange={(e) => setFullName(e.target.value)} disabled={busy} autoFocus />
          </label>

          <label className="text-sm block">
            <span className="block text-slate-500 mb-1">Subscription</span>
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

          <div className="grid grid-cols-2 gap-3">
            <label className="text-sm block">
              <span className="block text-slate-500 mb-1">Normal day</span>
              <select className="w-full p-2 border border-slate-200 rounded-lg text-sm" value={preferredDay} onChange={(e) => setPreferredDay(e.target.value)} disabled={busy}>
                <option value="">—</option>
                {DAYS.map((d) => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
            </label>
            <label className="text-sm block">
              <span className="block text-slate-500 mb-1">Normal session time</span>
              <input type="time" className="w-full p-2 border border-slate-200 rounded-lg text-sm" value={preferredTime} onChange={(e) => setPreferredTime(e.target.value)} disabled={busy} />
            </label>
          </div>

          <label className="text-sm block">
            <span className="block text-slate-500 mb-1">Date joined</span>
            <input type="date" className="w-full p-2 border border-slate-200 rounded-lg text-sm" value={joined} onChange={(e) => setJoined(e.target.value)} disabled={busy} />
          </label>

          <div>
            <span className="block text-slate-500 text-sm mb-1">{isEdit ? 'Level' : 'Level & starting lesson'}</span>
            {loadingCurriculum ? (
              <div className="text-sm text-slate-400">Loading curriculum…</div>
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
            <span className="block text-slate-500 mb-1">Notes <span className="text-slate-400">(optional)</span></span>
            <textarea className="w-full p-2 border border-slate-200 rounded-lg text-sm" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} disabled={busy} />
          </label>

          {isEdit && (
            <label className="text-sm flex items-center gap-2">
              <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} disabled={busy} />
              Active
            </label>
          )}
        </div>

        <div className="flex justify-end gap-2 mt-5">
          <button className="btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <BusyButton busy={busy} onClick={() => void save()}>{isEdit ? 'Save changes' : 'Add student'}</BusyButton>
        </div>
      </div>
    </div>
  )
}
