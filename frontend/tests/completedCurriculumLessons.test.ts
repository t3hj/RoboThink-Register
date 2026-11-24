import { expect, it } from 'vitest'
import { completedCurriculumLessons } from '../src/lib/completedCurriculumLessons'
import { studentAttendance } from '../src/lib/studentAttendance'
const count = (...args: Parameters<typeof completedCurriculumLessons>) => completedCurriculumLessons(...args).length
const day = '2026-11-24'
const lesson = { id: 'l1', level_id: 1, lesson_number: 1, lesson_kind: 'normal' as const }
const curriculum = [lesson, { ...lesson, id: 'l2', level_id: 2 }, { ...lesson, id: 'a', lesson_number: 2, assessment_required: true }]
const visit = { id: 'v1', session_number: 1, actual_lesson_id: 'l1', lesson_record_id: 'r1', date: day, outcome: 'completed' as const }
const record = { id: 'r1', level_id: 1, lesson_number: 1, date: day, status: 'completed' as const }

it('counts two visits and one distinct completion after an unfinished repeat', () => {
  const visits = [visit, { ...visit, id: 'v2', session_number: 2, outcome: 'not_finished' as const }]
  expect(studentAttendance([], visits, day).sessionsAttended).toBe(2)
  expect(count(curriculum, visits, [{ ...record, status: 'not_completed' }], day)).toBe(1)
  expect(count(curriculum, [visit, visit], [record], day)).toBe(1)
})

it('counts standalone history by level and lesson without inferring additional sessions', () => {
  expect(count(curriculum, [visit], [record, { ...record, id: 'legacy', level_id: 2 }], day)).toBe(2)
  expect(studentAttendance([], [visit], day).sessionsAttended).toBe(1)
})

it('excludes assessment, project, remediation and unfinished visits and their linked summaries', () => {
  const visits = [
    { ...visit, actual_lesson_id: 'a' }, { ...visit, project_id: 'project' },
    { ...visit, remediation_title: 'Practice' }, { ...visit, remediation_lessons: [{}] },
    { ...visit, assessment_records: [{}] }, { ...visit, outcome: 'not_finished' as const },
  ]
  for (const entry of visits) expect(count(curriculum, [entry], [record], day)).toBe(0)
  expect(count(curriculum, [], [{ ...record, lesson_number: 2 }], day)).toBe(0)
})

it('uses corrected visits and excludes future and removed completions', () => {
  expect(count(curriculum, [{ ...visit, actual_lesson_id: 'l2' }], [record, { ...record, id: 'other', level_id: 2 }], day)).toBe(1)
  expect(count(curriculum, [{ ...visit, date: '2026-11-25' }], [record, { ...record, id: 'later', date: '2026-11-25' }], day)).toBe(0)
  expect(count(curriculum, [], [], day)).toBe(0)
})
