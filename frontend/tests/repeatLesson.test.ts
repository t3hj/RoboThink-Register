import { describe, it, expect } from 'vitest'

/**
 * Mirrors the lesson_records UNIQUE(student_id, level_id, lesson_number)
 * upsert semantics used by both the "Not Finished / Repeat" action (plain
 * client upsert, status='not_completed') and complete_current_lesson's
 * ON CONFLICT ... DO UPDATE (status='completed'). See
 * db/migrations_applied_2026-09-13 for the actual SQL.
 */

type Status = 'completed' | 'not_completed'
interface LessonRecordRow {
  student_id: string
  level_id: number
  lesson_number: number
  status: Status
}

function upsertLessonRecord(rows: LessonRecordRow[], row: LessonRecordRow): LessonRecordRow[] {
  const idx = rows.findIndex((r) => r.student_id === row.student_id && r.level_id === row.level_id && r.lesson_number === row.lesson_number)
  if (idx === -1) return [...rows, row]
  const next = [...rows]
  next[idx] = row
  return next
}

interface StudentState {
  current_level_id: number
  current_lesson_number: number
}

/** Mirrors repeatLesson() in Register.tsx: writes a lesson_records row but
 *  never touches the student's current lesson. */
function repeatLesson(records: LessonRecordRow[], student: StudentState, studentId: string) {
  const records2 = upsertLessonRecord(records, {
    student_id: studentId,
    level_id: student.current_level_id,
    lesson_number: student.current_lesson_number,
    status: 'not_completed',
  })
  return { records: records2, student } // student unchanged
}

/** Mirrors complete_current_lesson: upserts to 'completed' AND advances the
 *  student to lesson_number + 1 (simplified — no term-boundary here, that's
 *  covered by tests/progression.test.ts). */
function completeLesson(records: LessonRecordRow[], student: StudentState, studentId: string) {
  const records2 = upsertLessonRecord(records, {
    student_id: studentId,
    level_id: student.current_level_id,
    lesson_number: student.current_lesson_number,
    status: 'completed',
  })
  const student2: StudentState = { ...student, current_lesson_number: student.current_lesson_number + 1 }
  return { records: records2, student: student2 }
}

describe('Not Finished / Repeat lesson', () => {
  it('records an attempt without advancing current_lesson_number', () => {
    let student: StudentState = { current_level_id: 8, current_lesson_number: 5 }
    let records: LessonRecordRow[] = []
    ;({ records, student } = repeatLesson(records, student, 's1'))
    expect(student.current_lesson_number).toBe(5)
    expect(records).toEqual([{ student_id: 's1', level_id: 8, lesson_number: 5, status: 'not_completed' }])
  })

  it('repeating twice does not create a duplicate curriculum lesson row', () => {
    let student: StudentState = { current_level_id: 8, current_lesson_number: 5 }
    let records: LessonRecordRow[] = []
    ;({ records, student } = repeatLesson(records, student, 's1'))
    ;({ records, student } = repeatLesson(records, student, 's1'))
    expect(records).toHaveLength(1)
    expect(student.current_lesson_number).toBe(5)
  })

  it('repeat then complete: current lesson stays put, then advances, and the history row ends up completed (not stuck on not_completed)', () => {
    let student: StudentState = { current_level_id: 8, current_lesson_number: 5 }
    let records: LessonRecordRow[] = []
    ;({ records, student } = repeatLesson(records, student, 's1'))
    expect(student.current_lesson_number).toBe(5)
    expect(records[0].status).toBe('not_completed')

    ;({ records, student } = completeLesson(records, student, 's1'))
    expect(student.current_lesson_number).toBe(6)
    expect(records).toHaveLength(1) // same row, upgraded — not a duplicate
    expect(records[0].status).toBe('completed')
  })

  it('complete without ever repeating still works as before', () => {
    let student: StudentState = { current_level_id: 8, current_lesson_number: 5 }
    let records: LessonRecordRow[] = []
    ;({ records, student } = completeLesson(records, student, 's1'))
    expect(student.current_lesson_number).toBe(6)
    expect(records[0].status).toBe('completed')
  })
})
