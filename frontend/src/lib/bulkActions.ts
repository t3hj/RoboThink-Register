import { attendanceState } from './attendedSessionsUi'
import type { AttendanceStatus } from '../types'

export interface BulkCandidate {
  id: string
  full_name: string
  status: AttendanceStatus | null | undefined
  sessionCount: number
  /** The session that a session-scoped bulk action (feedback) would
   *  target for this student — their most recent session on the selected
   *  date, if any. */
  targetSessionNumber?: number | null
}

export interface BulkEligibility<T extends BulkCandidate> {
  eligible: T[]
  skipped: { candidate: T; reason: string }[]
}

/** Mark Attended: eligible only for students not already "attended". */
export function eligibleForMarkAttended<T extends BulkCandidate>(candidates: T[]): BulkEligibility<T> {
  const eligible: T[] = []
  const skipped: { candidate: T; reason: string }[] = []
  for (const c of candidates) {
    if (attendanceState(c.status) === 'attended') skipped.push({ candidate: c, reason: 'Already marked Attended' })
    else eligible.push(c)
  }
  return { eligible, skipped }
}

/** Mark Absent: eligible only for students not already "absent". Existing
 *  sessions for a student are never touched or deleted by this action. */
export function eligibleForMarkAbsent<T extends BulkCandidate>(candidates: T[]): BulkEligibility<T> {
  const eligible: T[] = []
  const skipped: { candidate: T; reason: string }[] = []
  for (const c of candidates) {
    if (attendanceState(c.status) === 'absent') skipped.push({ candidate: c, reason: 'Already marked Absent' })
    else eligible.push(c)
  }
  return { eligible, skipped }
}

/** Lesson/Outcome and Not Finished both require the student to already be
 *  Attended — records a brand-new session for each eligible student
 *  (never edits an existing one), so it never risks corrupting a session
 *  already recorded individually. */
export function eligibleForSession<T extends BulkCandidate>(candidates: T[]): BulkEligibility<T> {
  const eligible: T[] = []
  const skipped: { candidate: T; reason: string }[] = []
  for (const c of candidates) {
    if (attendanceState(c.status) !== 'attended') skipped.push({ candidate: c, reason: 'Not marked Attended yet' })
    else eligible.push(c)
  }
  return { eligible, skipped }
}

/** Feedback can only be bulk-updated for students who already have a
 *  session recorded on the selected date. */
export function eligibleForFeedback<T extends BulkCandidate>(candidates: T[]): BulkEligibility<T> {
  const eligible: T[] = []
  const skipped: { candidate: T; reason: string }[] = []
  for (const c of candidates) {
    if (c.sessionCount === 0) skipped.push({ candidate: c, reason: 'No session recorded for this date' })
    else eligible.push(c)
  }
  return { eligible, skipped }
}

/** The most common current-lesson among a group — used as the bulk
 *  "Recommended" pick, since a group bulk action has no single student's
 *  current lesson to default to. Ties break toward the lowest lesson
 *  number for determinism. */
export function mostCommonLessonId(lessonIds: (string | null)[]): string | null {
  const counts = new Map<string, number>()
  for (const id of lessonIds) {
    if (!id) continue
    counts.set(id, (counts.get(id) ?? 0) + 1)
  }
  if (counts.size === 0) return null
  let best: string | null = null
  let bestCount = -1
  for (const [id, count] of counts) {
    if (count > bestCount) {
      best = id
      bestCount = count
    }
  }
  return best
}

export interface BulkResult {
  succeeded: string[]
  failed: { id: string; name: string; message: string }[]
}

/** Resolves which specific session (and therefore which specific
 *  feedback_sheets row) a session-scoped bulk action should target for a
 *  student on the selected date: their most recent session that date
 *  (highest session_number). Never touches any other session's feedback,
 *  even if the student has several for that date. */
export function resolveFeedbackTarget(
  sessionsToday: { id: string; session_number: number }[],
  feedbackForStudent: { id: string; attended_session_id: string | null }[],
): { targetSessionNumber: number | null; feedbackId: string | null } {
  if (sessionsToday.length === 0) return { targetSessionNumber: null, feedbackId: null }
  const target = sessionsToday.reduce((a, b) => (b.session_number > a.session_number ? b : a))
  const feedback = feedbackForStudent.find((f) => f.attended_session_id === target.id) ?? null
  return { targetSessionNumber: target.session_number, feedbackId: feedback?.id ?? null }
}

/** Turns a batch of settled promises into an honest, reportable summary —
 *  never claims "all N updated" when some failed. */
export function summarizeBulkResults(
  items: { id: string; name: string }[],
  results: PromiseSettledResult<unknown>[],
): BulkResult {
  const succeeded: string[] = []
  const failed: { id: string; name: string; message: string }[] = []
  results.forEach((r, i) => {
    const item = items[i]
    if (r.status === 'fulfilled') succeeded.push(item.id)
    else failed.push({ id: item.id, name: item.name, message: r.reason instanceof Error ? r.reason.message : String(r.reason) })
  })
  return { succeeded, failed }
}
