import { useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useToast } from './Toast'
import { BusyButton } from './ui'
import LevelLessonPicker from './LevelLessonPicker'
import type { Level, Lesson } from '../types'

interface Props {
  studentId: string
  levels: Level[]
  lessons: Lesson[]
  currentLevelId: number | null
  onDone: () => void
}

/** The "Change Current Lesson" workflow from the spec: an admin picks a
 *  programme/term/lesson, gives a reason, and the change is applied via the
 *  set_student_current_lesson RPC — which is admin-checked and audited
 *  server-side, not just hidden in the UI. */
export default function ChangeLessonControl({ studentId, levels, lessons, currentLevelId, onDone }: Props) {
  const { notify } = useToast()
  const [open, setOpen] = useState(false)
  const [levelId, setLevelId] = useState<number | null>(currentLevelId)
  const [lessonNumber, setLessonNumber] = useState<number | null>(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  async function save() {
    if (!levelId || !lessonNumber) {
      notify('Choose a programme, term and lesson first.', 'error')
      return
    }
    if (!reason.trim()) {
      notify('A reason is required.', 'error')
      return
    }
    const lesson = lessons.find((l) => l.level_id === levelId && l.lesson_number === lessonNumber)
    if (!lesson) {
      notify('Could not find that lesson.', 'error')
      return
    }
    setBusy(true)
    const { error } = await supabase.rpc('set_student_current_lesson', {
      in_student_id: studentId,
      in_lesson_id: lesson.id,
      in_reason: reason.trim(),
    })
    setBusy(false)
    if (error) {
      notify(error.message, 'error')
      return
    }
    notify('Current lesson updated', 'success')
    setOpen(false)
    setReason('')
    onDone()
  }

  if (!open) {
    return (
      <button className="btn-ghost text-sm" onClick={() => setOpen(true)}>
        Change current lesson
      </button>
    )
  }

  return (
    <div className="card p-4 border-amber-200 bg-amber-50/50">
      <h4 className="font-semibold mb-3 text-sm">Change current lesson</h4>
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
      <label className="text-sm block mt-3">
        <span className="block text-slate-500 mb-1">Reason (required)</span>
        <input
          type="text"
          className="w-full p-2 border border-slate-200 rounded-lg text-sm"
          placeholder="e.g. Transferred from another centre"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          disabled={busy}
        />
      </label>
      <div className="flex justify-end gap-2 mt-3">
        <button className="btn-ghost text-sm" onClick={() => setOpen(false)} disabled={busy}>
          Cancel
        </button>
        <BusyButton className="btn-primary text-sm" busy={busy} onClick={() => void save()}>
          Save
        </BusyButton>
      </div>
    </div>
  )
}
