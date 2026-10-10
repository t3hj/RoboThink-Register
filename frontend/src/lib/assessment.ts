import type { Lesson, RemediationPath, RemediationPlan } from '../types'

/** Assessment result entry is explicit curriculum metadata, with lesson_kind
 * retained as a fallback for deployments that have not run the new migration. */
export function requiresAssessmentResult(lesson: Pick<Lesson, 'lesson_kind' | 'assessment_required'> | null | undefined): boolean {
  return Boolean(lesson?.assessment_required || lesson?.lesson_kind === 'assessment')
}

export const REMEDIATION_PATH_OPTIONS: { value: RemediationPath; label: string; hint: string }[] = [
  { value: 'repeat_next_lesson', label: 'Repeat assessment next lesson', hint: 'No remediation lessons needed — reassess as soon as they next attend' },
  { value: 'remediation_lessons', label: '3 remediation lessons, then reassess', hint: 'Complete 3 similar-concept lessons first' },
]

/** A single, clear status line for the Register row and Student page —
 *  never relies on colour alone (see the accompanying `tone`). */
export function remediationStatusLabel(plan: Pick<RemediationPlan, 'status' | 'remediation_path' | 'lessons_completed' | 'lessons_required'> | null): {
  label: string
  tone: 'warn' | 'bad' | 'info'
} | null {
  if (!plan) return null
  if (plan.status === 'intervention_required') return { label: 'Intervention required', tone: 'bad' }
  if (plan.status === 'ready_for_reassessment') {
    return plan.remediation_path === 'repeat_next_lesson'
      ? { label: 'Repeat assessment due', tone: 'info' }
      : { label: 'Ready for reassessment', tone: 'info' }
  }
  if (plan.status === 'required' || plan.status === 'in_progress') {
    return { label: `Remediation ${plan.lessons_completed} of ${plan.lessons_required}`, tone: 'warn' }
  }
  return null
}
