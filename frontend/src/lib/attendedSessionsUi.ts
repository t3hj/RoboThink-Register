import type { AttendanceStatus, LeftAsideReason, SessionOutcome } from '../types'

export const NOT_FINISHED_REASONS: { value: LeftAsideReason; label: string }[] = [
  { value: 'motors_not_working', label: 'Motors not working' },
  { value: 'sensor_issue', label: 'Sensor issue' },
  { value: 'missing_pieces', label: 'Missing/incorrect pieces' },
  { value: 'build_incomplete', label: 'Build incomplete' },
  { value: 'coding_incomplete', label: 'Coding activity incomplete' },
  { value: 'ran_out_of_time', label: 'Student ran out of time' },
  { value: 'needed_help', label: 'Student needed help' },
  { value: 'other', label: 'Other' },
]

export const LEFT_ASIDE_LABELS: Record<LeftAsideReason, string> = Object.fromEntries(
  NOT_FINISHED_REASONS.map((r) => [r.value, r.label]),
) as Record<LeftAsideReason, string>

export type RegisterAttendanceState = 'not_entered' | 'attended' | 'absent'

/** The Register's three-state model. A row with no attendance record, or
 *  one still sitting at 'Not Arrived' (e.g. from Add to Register), reads
 *  as "not entered" — only an explicit Attended/Absent choice moves it. */
export function attendanceState(status: AttendanceStatus | null | undefined): RegisterAttendanceState {
  if (status === 'Absent') return 'absent'
  if (status === 'Arrived' || status === 'Completed') return 'attended'
  return 'not_entered'
}

export function outcomeToAttendanceStatus(outcome: SessionOutcome): AttendanceStatus {
  return outcome === 'completed' ? 'Completed' : 'Arrived'
}

/** Lesson numbers "around" the current one, clipped to the real range and
 *  excluding the current lesson itself (which is always shown separately
 *  as "Recommended") — keeps the default picker small instead of dumping
 *  the whole curriculum on the instructor. */
export function nearbyLessonNumbers(current: number, totalLessons: number, radius = 2): number[] {
  const out: number[] = []
  for (let n = current - radius; n <= current + radius; n++) {
    if (n >= 1 && n <= totalLessons && n !== current) out.push(n)
  }
  return out
}

export interface CompletenessInput {
  status: AttendanceStatus | null | undefined
}

/** Counts only ACTIVE students (callers must pre-filter) whose attendance
 *  has been explicitly recorded as Attended or Absent. */
export function registerCompleteness(rows: CompletenessInput[]): { recorded: number; total: number; notEntered: number } {
  const total = rows.length
  const recorded = rows.filter((r) => attendanceState(r.status) !== 'not_entered').length
  return { recorded, total, notEntered: total - recorded }
}

/** Whether a student's most recent session (any date) left a build/laptop
 *  aside unfinished — this is what drives the "use build B12 to finish
 *  the lesson" reminder, and it deliberately looks at the most recent
 *  session regardless of date, so it follows the student to whatever day
 *  they next appear on (normal, catch-up, or otherwise). */
export function needsLeftAsideReminder(mostRecentSession: { outcome: string; left_aside: boolean } | null | undefined): boolean {
  return Boolean(mostRecentSession && mostRecentSession.outcome === 'not_finished' && mostRecentSession.left_aside)
}

export interface LeftAsideInput {
  leftAside: boolean
  identifier: string
  reason: LeftAsideReason | ''
  note: string
}

/** Mirrors the DB CHECK constraints on attended_sessions exactly, so the
 *  UI can give an instant, friendly message instead of a round-trip error. */
export function validateLeftAside(input: LeftAsideInput): string | null {
  if (!input.leftAside) return null
  if (!input.identifier.trim()) return 'An identifier for the build/laptop is required.'
  if (!input.reason) return 'A reason is required.'
  if (input.reason === 'other' && !input.note.trim()) return 'A note is required when the reason is Other.'
  return null
}

/** Non-blocking "this will count as a repeat" warning: only fires when the
 *  chosen lesson was already completed before today, and — when editing an
 *  existing session — not for that same session's own original lesson
 *  (editing a session shouldn't warn about the very thing it already is). */
export function previouslyCompletedWarningDate(
  lessonNumber: number,
  previouslyCompleted: Map<number, string>,
  isUnchangedFromExistingSession: boolean,
): string | null {
  if (isUnchangedFromExistingSession) return null
  return previouslyCompleted.get(lessonNumber) ?? null
}

/** Reopening an existing session must update it, never insert a new one —
 *  this is the single branch point that decides which RPC Save calls. */
export function saveOperationFor(editingSessionId: string | null): 'insert' | 'update' {
  return editingSessionId ? 'update' : 'insert'
}
