import type { Assessment, AssessmentPoint, AttendedSession, Lesson, LessonRecord } from '../types'

type DatedEntry = { student_id: string; date: string; profiles?: { name: string } | null }
type Visit = DatedEntry & Pick<AttendedSession, 'id' | 'actual_lesson_id' | 'lesson_record_id' | 'outcome' | 'project_id' | 'remediation_title'> & {
  remediation_lessons?: readonly unknown[] | null
}
type Summary = DatedEntry & Pick<LessonRecord, 'id' | 'level_id' | 'lesson_number' | 'status'> & {
  attended_sessions?: readonly unknown[] | null
}
type Attempt = DatedEntry & Pick<Assessment, 'attended_session_id' | 'assessment_point_id' | 'passed' | 'result'>
type Completion = DatedEntry & { lesson: Lesson }

/** Credit the first recorded finish in the supplied period, once per student and curriculum item. */
export function curriculumCompletions(
  lessons: Lesson[], visits: Visit[], summaries: Summary[], assessments: Attempt[],
  points: Pick<AssessmentPoint, 'id' | 'after_lesson_id'>[], through: string,
) {
  const byId = new Map(lessons.map(l => [l.id, l]))
  const byNumber = new Map(lessons.map(l => [l.level_id + ':' + l.lesson_number, l]))
  const pointLessons = new Map(points.map(p => [p.id, p.after_lesson_id]))
  const linked = new Set(visits.map(v => v.lesson_record_id))
  const completed = new Map<string, Completion>()
  function credit(row: DatedEntry, lesson?: Lesson) {
    if (!lesson || row.date > through) return
    const key = row.student_id + ':' + lesson.id
    const previous = completed.get(key)
    if (!previous || previous.date > row.date) completed.set(key, { ...row, lesson })
  }
  for (const visit of visits) {
    if (visit.outcome === 'completed' && visit.actual_lesson_id && !visit.project_id &&
        !visit.remediation_title && !visit.remediation_lessons?.length) credit(visit, byId.get(visit.actual_lesson_id))
  }
  for (const row of summaries) {
    if (row.status === 'completed' && !linked.has(row.id) && !row.attended_sessions?.length)
      credit(row, byNumber.get(row.level_id + ':' + row.lesson_number))
  }
  for (const attempt of assessments) {
    if (attempt.attended_session_id || !attempt.assessment_point_id) continue
    if (attempt.result === 'PASS' || attempt.result === 'FAIL' || typeof attempt.passed === 'boolean')
      credit(attempt, byId.get(pointLessons.get(attempt.assessment_point_id) ?? ''))
  }
  return [...completed.values()]
}
