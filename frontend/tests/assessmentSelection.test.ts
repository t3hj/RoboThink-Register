import { describe, expect, it } from 'vitest'
import { requiresAssessmentResult } from '../src/lib/assessment'

describe('requiresAssessmentResult', () => {
  it('requires a result for lesson kinds already marked as assessments', () => {
    expect(requiresAssessmentResult({ lesson_kind: 'assessment', assessment_required: false })).toBe(true)
  })

  it('requires a result for regular progression lessons explicitly marked as assessments', () => {
    expect(requiresAssessmentResult({ lesson_kind: 'normal', assessment_required: true })).toBe(true)
  })

  it('keeps ordinary lessons on the normal outcome flow', () => {
    expect(requiresAssessmentResult({ lesson_kind: 'normal', assessment_required: false })).toBe(false)
  })
})
