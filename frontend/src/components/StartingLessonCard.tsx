import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { loadCurriculum } from '../lib/curriculumData'
import { useToast } from './Toast'
import LevelLessonPicker from './LevelLessonPicker'
import type { Level, Lesson } from '../types'

interface Props {
  studentId: string
  studentName: string
  onDone: () => void
}

/** For a student with no current lesson yet (for example one imported from
 *  Pebble): pick the level and lesson they are on. Goes through a database
 *  function that only works while the student has no lesson, so it can never
 *  be used to rewrite an existing student's progress. */
export default function StartingLessonCard({ studentId, studentName, onDone }: Props) {
  const { notify } = useToast()
  const [levels, setLevels] = useState<Level[]>([])
  const [lessons, setLessons] = useState<Lesson[]>([])
  const [levelId, setLevelId] = useState<number | null>(null)
  const [lessonNumber, setLessonNumber] = useState<number | null>(1)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    void loadCurriculum().then(({ levels: lv, lessons: le }) => {
      if (cancelled) return
      setLevels(lv)
      setLessons(le)
      if (lv.length) setLevelId(lv[0].id)
    })
    return () => {
      cancelled = true
    }
  }, [])

  async function save() {
    const lesson = lessons.find((l) => l.level_id === levelId && l.lesson_number === lessonNumber)
    if (!lesson) return notify('Choose a level and lesson.', 'error')
    setBusy(true)
    const { error } = await supabase.rpc('set_starting_lesson', { p_student_id: studentId, p_lesson_id: lesson.id })
    setBusy(false)
    if (error) return notify(error.message, 'error')
    notify(`${studentName}'s starting lesson saved`, 'success')
    onDone()
  }

  return (
    <section className="card card-accent-top p-5 my-5" style={{ ['--accent-color' as string]: 'var(--rt-yellow)' }}>
      <h2 className="text-lg font-semibold">Choose {studentName}’s starting lesson</h2>
      <p className="text-sm text-slate-600 mb-3">
        This student has no lesson yet. Pick the level and lesson they are on now. After this, their lesson moves on
        automatically as you record sessions.
      </p>
      {levels.length === 0 ? (
        <div className="text-sm text-slate-600">Loading curriculum…</div>
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
      <div className="mt-4">
        <button className="btn-primary" onClick={() => void save()} disabled={busy || levels.length === 0}>
          {busy ? 'Saving…' : 'Save starting lesson'}
        </button>
      </div>
    </section>
  )
}
