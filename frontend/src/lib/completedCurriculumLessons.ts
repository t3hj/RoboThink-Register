import type { AttendedSession, Lesson, LessonRecord } from '../types'
import { requiresAssessmentResult } from './assessment'

type CurriculumEntry = Pick<Lesson, 'id' | 'level_id' | 'lesson_number' | 'lesson_kind' | 'assessment_required'>
type Visit = Pick<AttendedSession, 'date' | 'outcome' | 'actual_lesson_id' | 'lesson_record_id' | 'project_id' | 'remediation_title'> & {
  assessment_records?: readonly unknown[] | null
  remediation_lessons?: readonly unknown[] | null
}
type HistoryEntry = Pick<LessonRecord, 'id' | 'date' | 'status' | 'level_id' | 'lesson_number'>
const key = (lesson: Pick<Lesson, 'level_id' | 'lesson_number'>) => lesson.level_id + ':' + lesson.lesson_number

/** A summary shared by repeated visits only describes the latest outcome.
 * Use dated visits for linked summaries, and retain standalone historical entries. */
export function completedCurriculumLessons<T extends CurriculumEntry>(curriculum: T[], visits: Visit[], history: HistoryEntry[], through: string) {
  const normal = curriculum.filter(lesson => lesson.lesson_kind === 'normal' && !requiresAssessmentResult(lesson))
  const byId = new Map(normal.map(lesson => [lesson.id, key(lesson)]))
  const normalKeys = new Set(byId.values())
  const linked = new Set(visits.map(visit => visit.lesson_record_id))
  const completed = new Set<string>()
  for (const visit of visits) {
    if (visit.date > through || visit.outcome !== 'completed' || !visit.actual_lesson_id ||
        visit.project_id || visit.remediation_title || visit.assessment_records?.length || visit.remediation_lessons?.length) continue
    const lesson = byId.get(visit.actual_lesson_id)
    if (lesson) completed.add(lesson)
  }
  for (const record of history) {
    const lesson = key(record)
    if (record.date <= through && record.status === 'completed' && !linked.has(record.id) && normalKeys.has(lesson)) {
      completed.add(lesson)
    }
  }
  return normal.filter(lesson => completed.has(key(lesson)))
}
