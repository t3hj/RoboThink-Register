import { expect, it } from 'vitest'
import type { Lesson } from '../src/types'
import { curriculumCompletions } from '../src/lib/curriculumCompletions'

const day = '2026-11-24'
const curriculum = [{ id: 'assessment', level_id: 1, lesson_number: 7, lesson_kind: 'assessment' },
  { id: 'build', level_id: 1, lesson_number: 6, lesson_kind: 'normal' }] as Lesson[]
const visit = { id: 'visit', date: day, student_id: 'one', actual_lesson_id: 'assessment', outcome: 'completed' as const, lesson_record_id: null }
const history = { id: 'legacy', student_id: 'one', date: day, level_id: 1, lesson_number: 7, status: 'completed' as const }
const result = { date: day, student_id: 'one', attended_session_id: null, assessment_point_id: 'point', passed: false, result: 'FAIL' }
const points = [{ id: 'point', after_lesson_id: 'assessment' }]

it('credits a finished assessment once across results, repeats and historical summaries', () => {
  for (const passed of [true, false]) {
    const attempt = { ...result, passed, result: passed ? 'PASS' : 'FAIL' }
    expect(curriculumCompletions(curriculum, [], [], [attempt], points, day)).toHaveLength(1)
    expect(curriculumCompletions(curriculum, [visit, visit], [history], [attempt], points, day)).toHaveLength(1)
  }
})
it('counts independently for each student and item, preserving earlier completions', () => {
  const visits = [visit, { ...visit, student_id: 'two' }, { ...visit, actual_lesson_id: 'build' },
    { ...visit, outcome: 'not_finished' as const }]
  expect(curriculumCompletions(curriculum, visits, [], [], points, day)).toHaveLength(3)
})
it('excludes an unfinished or future assessment, a project and remediation', () => {
  for (const changes of [{ outcome: 'not_finished' as const }, { date: '2026-11-25' }, { project_id: 'p' }, { remediation_lessons: [{}] }]) {
    expect(curriculumCompletions(curriculum, [{ ...visit, ...changes, lesson_record_id: history.id }], [history],
      [{ ...result, attended_session_id: visit.id }], points, day)).toHaveLength(0)
  }
})
it('attributes a repeated completion to the earliest dated instructor in the report', () => {
  const earlier = { ...visit, date: '2026-11-18', profiles: { name: 'Earlier instructor' } }
  expect(curriculumCompletions(curriculum, [visit, earlier], [], [], points, day)[0].profiles).toEqual(earlier.profiles)
})
