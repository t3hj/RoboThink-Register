import type { FeedbackStatus } from '../types'

export const FEEDBACK_LABELS: Record<FeedbackStatus, string> = {
  not_written: 'Not written',
  written_not_taken: "Written — hasn't taken it",
  given: 'Given',
}

export const FEEDBACK_OPTIONS: { value: FeedbackStatus; label: string }[] = [
  { value: 'not_written', label: 'Not written yet' },
  { value: 'written_not_taken', label: "Written — student hasn't taken" },
  { value: 'given', label: 'Given out' },
]

/** Short form used in the compact Register reminders summary, e.g.
 *  "Aarav — written, needs giving". */
export const FEEDBACK_SHORT: Partial<Record<FeedbackStatus, string>> = {
  not_written: 'not written',
  written_not_taken: 'written, needs giving',
}

/** Whether a feedback sheet still needs instructor action. Attendance never
 *  changes this — only an explicit status change to 'given' does. */
export function isOutstanding(status: FeedbackStatus): boolean {
  return status !== 'given'
}

/** Short reminder text shown beside a student's name in the Register.
 *  Deliberately worded (not colour-only) so it reads fine without colour. */
export function feedbackReminderText(status: FeedbackStatus): string | null {
  if (status === 'not_written') return 'Feedback not written'
  if (status === 'written_not_taken') return 'Feedback ready — needs giving'
  return null
}

/** Given a student's feedback_sheets rows (any subset, any order), find the
 *  single outstanding one to show as a reminder, if any. Only looks at
 *  status — never at the session's date/schedule, so it fires the same way
 *  whether the student is on their normal day, a catch-up, or any other
 *  session. Most recent outstanding sheet wins if there is somehow more
 *  than one (there shouldn't be, in normal use). */
export function findOutstandingFeedback<T extends { status: FeedbackStatus; created_at: string }>(sheets: T[]): T | null {
  const outstanding = sheets.filter((s) => isOutstanding(s.status))
  if (outstanding.length === 0) return null
  return outstanding.sort((a, b) => b.created_at.localeCompare(a.created_at))[0]
}
