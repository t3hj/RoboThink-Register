// Derives the lesson a student should be shown for their NEXT session from the
// ACTUAL recorded lesson history, rather than trusting only the stored
// students.current_lesson_id pointer.
//
// Why this exists: current_lesson_id is a denormalised pointer that only the
// register RPCs (record_attended_session / complete_current_lesson) advance.
// When historical attendance/session data is backfilled or imported straight
// into the session tables, the pointer is left behind, so the Register showed a
// lesson the student had already completed instead of the next one. The
// recorded session/lesson history is the source of truth.
//
// The existing progression rules still decide everything they decided before:
//   * an active assessment / remediation / completed curriculum is NOT a normal
//     progression state, so the stored current lesson is kept unchanged;
//   * students.override_next_lesson (set by admins/migrations) still wins;
//   * only COMPLETED lesson records count, so a repeat, a "not finished" or any
//     other session that did not progress leaves the expected lesson where it
//     was. Repeats share the one lesson_records row (UNIQUE per student/level/
//     lesson_number), so re-doing a lesson never adds a second entry.

import type { Lesson, Level, ProgressKind } from '../types'

/** A lesson the student holds a COMPLETED lesson_records row for. */
export interface CompletedLesson {
  level_id: number
  lesson_number: number
}

export interface ExpectedLessonInput {
  /** students.current_level_id */
  currentLevelId: number | null
  /** student_progress.current_kind — the student's current progression state. */
  currentKind: ProgressKind | null
  /** students.override_next_lesson */
  overrideNextLesson: number | null
  /** Every COMPLETED lesson recorded for the student, across all levels. */
  completed: CompletedLesson[]
}

type LevelRef = Pick<Level, 'id' | 'slug' | 'sort_order'>
type LessonRef = Pick<Lesson, 'id' | 'level_id' | 'lesson_number' | 'title'>

/** The next lesson in curriculum order after (levelId, lessonNumber): the next
 *  lesson number in the same level, otherwise lesson 1 of the next level by
 *  sort_order — keeping the coding track separate from the main programme.
 *  Mirrors public.next_curriculum_lesson, so term boundaries roll over
 *  correctly instead of running past the end of a level. */
export function nextLessonAfter<L extends LessonRef>(
  levelId: number,
  lessonNumber: number,
  levels: LevelRef[],
  lessons: L[],
): L | null {
  const sameLevel = lessons
    .filter((l) => l.level_id === levelId && l.lesson_number > lessonNumber)
    .sort((a, b) => a.lesson_number - b.lesson_number)[0]
  if (sameLevel) return sameLevel

  const currentLevel = levels.find((lv) => lv.id === levelId)
  if (!currentLevel) return null
  const candidateLevels = levels
    .filter((lv) =>
      currentLevel.slug === 'coding'
        ? lv.slug === 'coding'
        : lv.slug !== 'coding' && lv.sort_order > currentLevel.sort_order,
    )
    .sort((a, b) => a.sort_order - b.sort_order)
  for (const lv of candidateLevels) {
    const first = lessons.find((l) => l.level_id === lv.id && l.lesson_number === 1)
    if (first) return first
  }
  return null
}

/** The lesson to show for the student's next session, or null to keep the
 *  stored current lesson (no history yet, non-normal progression state, or the
 *  end of the curriculum). */
export function deriveExpectedLesson<L extends LessonRef>(
  input: ExpectedLessonInput,
  levels: LevelRef[],
  lessons: L[],
): L | null {
  if (input.currentKind !== 'normal' || input.currentLevelId == null) return null

  const inLevel = input.completed.filter((c) => c.level_id === input.currentLevelId)
  if (inLevel.length === 0) return null
  const latest = inLevel.reduce((a, b) => (b.lesson_number > a.lesson_number ? b : a))

  // An override ahead of the recorded history still wins, exactly as
  // compute_next_lesson does.
  if (input.overrideNextLesson != null && input.overrideNextLesson > latest.lesson_number) {
    const overridden = lessons.find(
      (l) => l.level_id === input.currentLevelId && l.lesson_number === input.overrideNextLesson,
    )
    if (overridden) return overridden
  }

  return nextLessonAfter(input.currentLevelId, latest.lesson_number, levels, lessons)
}
