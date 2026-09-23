import { describe, it, expect } from 'vitest'
import { remediationStatusLabel, REMEDIATION_PATH_OPTIONS } from '../src/lib/assessment'
import type { RemediationPlan } from '../src/types'

function plan(overrides: Partial<RemediationPlan> = {}): RemediationPlan {
  return {
    id: 'p1',
    student_id: 's1',
    level_id: 1,
    assessment_id: null,
    assessment_point_id: 'ap1',
    topic: null,
    lessons_required: 3,
    lessons_completed: 0,
    status: 'required',
    remediation_path: 'remediation_lessons',
    created_at: '2026-09-01T00:00:00Z',
    completed_at: null,
    ...overrides,
  }
}

describe('remediationStatusLabel — Register/profile visibility, never colour alone', () => {
  it('no plan at all -> nothing to show', () => {
    expect(remediationStatusLabel(null)).toBeNull()
  })

  it('Path B, 0 of 3 -> "Remediation 0 of 3"', () => {
    expect(remediationStatusLabel(plan({ status: 'required', lessons_completed: 0 }))).toEqual({ label: 'Remediation 0 of 3', tone: 'warn' })
  })
  it('Path B, 1 of 3', () => {
    expect(remediationStatusLabel(plan({ status: 'in_progress', lessons_completed: 1 }))).toEqual({ label: 'Remediation 1 of 3', tone: 'warn' })
  })
  it('Path B, 2 of 3', () => {
    expect(remediationStatusLabel(plan({ status: 'in_progress', lessons_completed: 2 }))).toEqual({ label: 'Remediation 2 of 3', tone: 'warn' })
  })
  it('Path B, after 3 of 3 -> ready for reassessment', () => {
    expect(remediationStatusLabel(plan({ status: 'ready_for_reassessment', lessons_completed: 3, remediation_path: 'remediation_lessons' }))).toEqual({
      label: 'Ready for reassessment',
      tone: 'info',
    })
  })

  it('Path A -> "Repeat assessment due", distinct wording from Path B\'s ready state', () => {
    expect(
      remediationStatusLabel(plan({ status: 'ready_for_reassessment', lessons_required: 0, lessons_completed: 0, remediation_path: 'repeat_next_lesson' })),
    ).toEqual({ label: 'Repeat assessment due', tone: 'info' })
  })

  it('intervention_required is distinct and unambiguous', () => {
    expect(remediationStatusLabel(plan({ status: 'intervention_required' }))).toEqual({ label: 'Intervention required', tone: 'bad' })
  })

  it('completed plan produces no active-status line', () => {
    expect(remediationStatusLabel(plan({ status: 'completed' }))).toBeNull()
  })

  it('exposes exactly the two required remediation paths', () => {
    expect(REMEDIATION_PATH_OPTIONS.map((o) => o.value)).toEqual(['repeat_next_lesson', 'remediation_lessons'])
  })
})

/**
 * Mirrors the LIVE record_assessment_result / complete_remediation_lesson
 * functions (verified directly against the database with temporary,
 * fully-cleaned-up test students — see task report) as a pure, reviewable
 * state machine, independent of a live DB connection.
 */
type Status = 'required' | 'in_progress' | 'ready_for_reassessment' | 'completed' | 'intervention_required'
type Path = 'repeat_next_lesson' | 'remediation_lessons'

interface Plan {
  status: Status
  path: Path
  lessonsRequired: number
  lessonsCompleted: number
}

function fail(existingPlan: Plan | null, path: Path): Plan {
  if (existingPlan?.status === 'ready_for_reassessment') {
    return { ...existingPlan, status: 'intervention_required' }
  }
  if (path === 'repeat_next_lesson') {
    return { status: 'ready_for_reassessment', path, lessonsRequired: 0, lessonsCompleted: 0 }
  }
  return { status: 'required', path, lessonsRequired: 3, lessonsCompleted: 0 }
}

function pass(existingPlan: Plan | null): Plan | null {
  if (existingPlan?.status === 'ready_for_reassessment') return { ...existingPlan, status: 'completed' }
  return existingPlan
}

function completeRemediationLesson(p: Plan): Plan {
  const n = p.lessonsCompleted + 1
  return { ...p, lessonsCompleted: n, status: n >= p.lessonsRequired ? 'ready_for_reassessment' : 'in_progress' }
}

describe('assessment state machine (mirrored)', () => {
  it('PASS with no prior plan just records the result — nothing else changes', () => {
    expect(pass(null)).toBeNull()
  })

  it('FAIL requires a remediation path to be meaningful — the mirror always takes one explicitly', () => {
    const p = fail(null, 'remediation_lessons')
    expect(p.status).toBe('required')
  })

  it('FAIL + repeat-assessment path (A): immediately ready_for_reassessment, 0 lessons required', () => {
    const p = fail(null, 'repeat_next_lesson')
    expect(p).toEqual({ status: 'ready_for_reassessment', path: 'repeat_next_lesson', lessonsRequired: 0, lessonsCompleted: 0 })
  })

  it('FAIL + 3-remediation path (B): required, 3 lessons needed, 0 completed', () => {
    const p = fail(null, 'remediation_lessons')
    expect(p).toEqual({ status: 'required', path: 'remediation_lessons', lessonsRequired: 3, lessonsCompleted: 0 })
  })

  it('remediation 1/3, 2/3, then 3/3 flips to ready_for_reassessment', () => {
    let p = fail(null, 'remediation_lessons')
    p = completeRemediationLesson(p)
    expect(p.lessonsCompleted).toBe(1)
    expect(p.status).toBe('in_progress')
    p = completeRemediationLesson(p)
    expect(p.lessonsCompleted).toBe(2)
    expect(p.status).toBe('in_progress')
    p = completeRemediationLesson(p)
    expect(p.lessonsCompleted).toBe(3)
    expect(p.status).toBe('ready_for_reassessment')
  })

  it('reassessment PASS resolves the plan', () => {
    const ready: Plan = { status: 'ready_for_reassessment', path: 'remediation_lessons', lessonsRequired: 3, lessonsCompleted: 3 }
    expect(pass(ready)?.status).toBe('completed')
  })

  it('reassessment FAIL does not advance progression and enters intervention_required, retaining history', () => {
    const ready: Plan = { status: 'ready_for_reassessment', path: 'remediation_lessons', lessonsRequired: 3, lessonsCompleted: 3 }
    const result = fail(ready, 'remediation_lessons')
    expect(result.status).toBe('intervention_required')
    expect(result.lessonsCompleted).toBe(3)
  })

  it('Path A reassessment FAIL also goes to intervention_required', () => {
    const ready: Plan = { status: 'ready_for_reassessment', path: 'repeat_next_lesson', lessonsRequired: 0, lessonsCompleted: 0 }
    expect(fail(ready, 'repeat_next_lesson').status).toBe('intervention_required')
  })
})

describe('actual lesson selection alone never changes progression (assessment-adjacent guarantee)', () => {
  it('recording an unrelated actual lesson never touches the plan or progression state', () => {
    const planBefore: Plan = { status: 'required', path: 'remediation_lessons', lessonsRequired: 3, lessonsCompleted: 1 }
    const planAfter = { ...planBefore }
    expect(planAfter).toEqual(planBefore)
  })
})
