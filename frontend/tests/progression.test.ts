import { describe, it, expect } from 'vitest'

/**
 * Mirrors db/migration_001_progression_and_rls.sql::compute_next_lesson so the
 * rule is pinned by a runnable test even without a live Supabase instance.
 *
 * Rule:
 *  1. next = max(completed lesson_number in current level) + 1
 *  2. a manual override higher than max completed wins
 *  3. NULL level -> fall back to most recent level with completions
 *  4. no level at all -> NULL (UI shows "—")
 */
function computeNextLesson(student: {
  current_level_id: number | null
  override_next_lesson: number | null
}, records: { student_id: string; level_id: number; lesson_number: number; status: 'completed' | 'not_completed' }[], studentId = 's1'): number | null {
  let lvl = student.current_level_id
  if (lvl == null) {
    const recent = [...records]
      .filter((r) => r.student_id === studentId && r.status === 'completed')
      .sort((a, b) => b.lesson_number - a.lesson_number)[0]
    lvl = recent?.level_id ?? null
  }
  if (lvl == null) return null
  const maxCompleted = records
    .filter((r) => r.student_id === studentId && r.level_id === lvl && r.status === 'completed')
    .reduce((m, r) => Math.max(m, r.lesson_number), 0)
  if (student.override_next_lesson != null && student.override_next_lesson > maxCompleted) {
    return student.override_next_lesson
  }
  return maxCompleted + 1
}

describe('compute_next_lesson (mirrored logic)', () => {
  it('returns 1 for a fresh student with no records', () => {
    expect(computeNextLesson({ current_level_id: 2, override_next_lesson: null }, [])).toBe(1)
  })

  it('returns max completed + 1', () => {
    const recs = [1, 2, 3, 4, 5].map((n) => ({ student_id: 's1', level_id: 2, lesson_number: n, status: 'completed' as const }))
    expect(computeNextLesson({ current_level_id: 2, override_next_lesson: null }, recs)).toBe(6)
  })

  it('never re-serves an already completed lesson', () => {
    const recs = [1, 2, 3].map((n) => ({ student_id: 's1', level_id: 1, lesson_number: n, status: 'completed' as const }))
    const next = computeNextLesson({ current_level_id: 1, override_next_lesson: null }, recs)
    expect(recs.some((r) => r.lesson_number === next)).toBe(false)
  })

  it('ignores not_completed records (missed lessons stay next)', () => {
    const recs = [
      { student_id: 's1', level_id: 1, lesson_number: 1, status: 'completed' as const },
      { student_id: 's1', level_id: 1, lesson_number: 2, status: 'not_completed' as const },
    ]
    expect(computeNextLesson({ current_level_id: 1, override_next_lesson: null }, recs)).toBe(2)
  })

  it('respects a manual override above max completed', () => {
    const recs = [1, 2].map((n) => ({ student_id: 's1', level_id: 3, lesson_number: n, status: 'completed' as const }))
    expect(computeNextLesson({ current_level_id: 3, override_next_lesson: 4 }, recs)).toBe(4)
  })

  it('ignores an override at or below max completed', () => {
    const recs = [1, 2, 3, 4, 5, 6].map((n) => ({ student_id: 's1', level_id: 3, lesson_number: n, status: 'completed' as const }))
    expect(computeNextLesson({ current_level_id: 3, override_next_lesson: 4 }, recs)).toBe(7)
  })

  it('falls back to the most recent level with completions when current_level_id is NULL', () => {
    const recs = [{ student_id: 's1', level_id: 2, lesson_number: 3, status: 'completed' as const }]
    expect(computeNextLesson({ current_level_id: null, override_next_lesson: null }, recs)).toBe(4)
  })

  it('returns NULL for a student with no level at all', () => {
    expect(computeNextLesson({ current_level_id: null, override_next_lesson: null }, [])).toBeNull()
  })

  it('progresses independently per student', () => {
    const recs = [
      { student_id: 's1', level_id: 1, lesson_number: 1, status: 'completed' as const },
      { student_id: 's2', level_id: 1, lesson_number: 1, status: 'completed' as const },
      { student_id: 's2', level_id: 1, lesson_number: 2, status: 'completed' as const },
    ]
    expect(computeNextLesson({ current_level_id: 1, override_next_lesson: null }, recs, 's1')).toBe(2)
    expect(computeNextLesson({ current_level_id: 1, override_next_lesson: null }, recs, 's2')).toBe(3)
  })
})

/** Mirrors the register's roster status machine. */
function nextActions(status: 'Not Arrived' | 'Arrived' | 'Absent' | 'Completed' | undefined) {
  if (!status || status === 'Not Arrived') return ['Arrived', 'Absent']
  if (status === 'Arrived') return ['Time Out', 'Mark Done']
  if (status === 'Absent') return ['Arrived']
  return []
}

describe('register status machine', () => {
  it('offers Arrived/Absent before marking', () => {
    expect(nextActions(undefined)).toEqual(['Arrived', 'Absent'])
    expect(nextActions('Not Arrived')).toEqual(['Arrived', 'Absent'])
  })
  it('offers Time Out and Mark Done once arrived', () => {
    expect(nextActions('Arrived')).toEqual(['Time Out', 'Mark Done'])
  })
  it('allows an absent student to be marked arrived', () => {
    expect(nextActions('Absent')).toEqual(['Arrived'])
  })
  it('offers no actions once completed', () => {
    expect(nextActions('Completed')).toEqual([])
  })
})

/** Mirrors the attendance-percentage calculation on the profile page. */
function attendancePct(rows: { status: string }[]): number | null {
  const attended = rows.filter((r) => r.status === 'Completed' || r.status === 'Arrived').length
  const absent = rows.filter((r) => r.status === 'Absent').length
  const relevant = attended + absent
  return relevant ? Math.round((attended / relevant) * 100) : null
}

describe('attendance percentage', () => {
  it('is NULL with no relevant rows', () => {
    expect(attendancePct([])).toBeNull()
  })
  it('computes correctly and rounds', () => {
    expect(attendancePct([{ status: 'Completed' }, { status: 'Absent' }])).toBe(50)
    expect(attendancePct([{ status: 'Completed' }, { status: 'Completed' }, { status: 'Absent' }])).toBe(67)
  })
  it('ignores rows with no mark', () => {
    expect(attendancePct([{ status: 'Not Arrived' }])).toBeNull()
  })
})
