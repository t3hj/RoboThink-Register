import { describe, it, expect } from 'vitest'

/**
 * Mirrors the LIVE Supabase functions (see project bvbrafmazxrfiaocqdjg):
 *   - public.initial_programme_for_dob(dob, joined)
 *   - public.next_curriculum_lesson(lesson_id)
 *   - public.complete_current_lesson's remediation gating
 * so the core progression rules are pinned by a runnable test even without a
 * live Supabase instance. These are deliberately written as *mirrors*, not
 * as the source of truth — the Postgres functions are canonical.
 */

// ---- initial_programme_for_dob -------------------------------------------

function initialPogrammeSlug(dob: string | null, joined: string): string | null {
  if (!dob) return null
  const cutoff = new Date(joined)
  cutoff.setFullYear(cutoff.getFullYear() - 7)
  return new Date(dob).getTime() <= cutoff.getTime() ? 'engineer-term-1' : 'junior-term-1'
}

describe('initial_programme_for_dob (mirrored logic)', () => {
  it('assigns Engineer at exactly age 7 on joining', () => {
    expect(initialPogrammeSlug('2018-01-01', '2025-01-01')).toBe('engineer-term-1')
  })
  it('assigns Junior Engineer under age 7 on joining', () => {
    expect(initialPogrammeSlug('2019-01-02', '2025-01-01')).toBe('junior-term-1')
  })
  it('assigns Engineer well above age 7', () => {
    expect(initialPogrammeSlug('2010-06-15', '2025-01-01')).toBe('engineer-term-1')
  })
  it('returns null with no date of birth', () => {
    expect(initialPogrammeSlug(null, '2025-01-01')).toBeNull()
  })
})

// ---- next_curriculum_lesson (term-boundary progression) -------------------

interface LevelRow {
  id: number
  slug: string
  sort_order: number
}
interface LessonRow {
  id: string
  level_id: number
  lesson_number: number
}

function nextCurriculumLesson(lessonId: string, levels: LevelRow[], lessons: LessonRow[]): string | null {
  const current = lessons.find((l) => l.id === lessonId)
  if (!current) return null
  const currentLevel = levels.find((lv) => lv.id === current.level_id)!
  // (a) another lesson later in the same level
  const sameLevel = lessons
    .filter((l) => l.level_id === current.level_id && l.lesson_number > current.lesson_number)
    .sort((a, b) => a.lesson_number - b.lesson_number)[0]
  if (sameLevel) return sameLevel.id
  // (b) lesson 1 of the next level by sort_order, respecting the coding track
  const candidateLevels = levels
    .filter((lv) =>
      currentLevel.slug === 'coding' ? lv.slug === 'coding' : lv.slug !== 'coding' && lv.sort_order > currentLevel.sort_order,
    )
    .sort((a, b) => a.sort_order - b.sort_order)
  for (const lv of candidateLevels) {
    const first = lessons.find((l) => l.level_id === lv.id && l.lesson_number === 1)
    if (first) return first.id
  }
  return null
}

describe('next_curriculum_lesson (mirrored term-boundary logic)', () => {
  const levels: LevelRow[] = [
    { id: 1, slug: 'engineer-term-1', sort_order: 1 },
    { id: 2, slug: 'engineer-term-2', sort_order: 2 },
    { id: 3, slug: 'engineer-term-3', sort_order: 3 },
    { id: 9, slug: 'coding', sort_order: 99 },
  ]
  const lessons: LessonRow[] = [
    ...Array.from({ length: 12 }, (_, i) => ({ id: `t1-${i + 1}`, level_id: 1, lesson_number: i + 1 })),
    ...Array.from({ length: 12 }, (_, i) => ({ id: `t2-${i + 1}`, level_id: 2, lesson_number: i + 1 })),
    ...Array.from({ length: 12 }, (_, i) => ({ id: `t3-${i + 1}`, level_id: 3, lesson_number: i + 1 })),
    { id: 'c-1', level_id: 9, lesson_number: 1 },
    { id: 'c-2', level_id: 9, lesson_number: 2 },
  ]

  it('advances to the next lesson within the same term', () => {
    expect(nextCurriculumLesson('t2-5', levels, lessons)).toBe('t2-6')
  })

  it('crosses a term boundary at the last lesson of a term (12 -> next term lesson 1)', () => {
    expect(nextCurriculumLesson('t2-12', levels, lessons)).toBe('t3-1')
  })

  it('the acceptance-test sequence: T2L5 -> T2L6 -> T2L7', () => {
    const l6 = nextCurriculumLesson('t2-5', levels, lessons)
    expect(l6).toBe('t2-6')
    const l7 = nextCurriculumLesson(l6!, levels, lessons)
    expect(l7).toBe('t2-7')
  })

  it('keeps the coding track separate from the main programme sequence', () => {
    expect(nextCurriculumLesson('c-1', levels, lessons)).toBe('c-2')
  })

  it('returns null after the final lesson of the final level', () => {
    expect(nextCurriculumLesson('t3-12', levels, lessons)).toBeNull()
  })
})

// ---- assessment / remediation state machine --------------------------------

type RemediationStatus = 'required' | 'in_progress' | 'ready_for_reassessment' | 'completed' | 'intervention_required'

function canCompleteLesson(kind: 'normal' | 'assessment' | 'remediation' | 'complete'): boolean {
  return kind === 'normal'
}

function recordResult(current: RemediationStatus | null, result: 'PASS' | 'FAIL'): RemediationStatus | null {
  if (result === 'PASS') {
    // Passing while ready-for-reassessment completes the plan; a first-time
    // pass (no plan yet) needs no plan at all.
    return null
  }
  // FAIL: first failure creates a plan requiring remediation; failing a
  // reassessment moves straight to intervention.
  return current === 'ready_for_reassessment' ? 'intervention_required' : 'required'
}

function completeRemediationLesson(completed: number, required: number): RemediationStatus {
  const next = completed + 1
  return next >= required ? 'ready_for_reassessment' : 'in_progress'
}

describe('assessment / remediation workflow (mirrored)', () => {
  it('blocks lesson completion while an assessment or remediation is pending', () => {
    expect(canCompleteLesson('normal')).toBe(true)
    expect(canCompleteLesson('assessment')).toBe(false)
    expect(canCompleteLesson('remediation')).toBe(false)
  })

  it('a first FAIL creates a remediation requirement', () => {
    expect(recordResult(null, 'FAIL')).toBe('required')
  })

  it('a PASS clears any remediation state', () => {
    expect(recordResult('ready_for_reassessment', 'PASS')).toBeNull()
  })

  it('three remediation lessons move the plan to ready_for_reassessment', () => {
    expect(completeRemediationLesson(0, 3)).toBe('in_progress')
    expect(completeRemediationLesson(1, 3)).toBe('in_progress')
    expect(completeRemediationLesson(2, 3)).toBe('ready_for_reassessment')
  })

  it('failing the reassessment requires intervention, not another remediation cycle', () => {
    expect(recordResult('ready_for_reassessment', 'FAIL')).toBe('intervention_required')
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
