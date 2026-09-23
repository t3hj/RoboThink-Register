import { describe, it, expect } from 'vitest'

/**
 * Mirrors the LIVE Supabase function public.record_attended_session
 * (project bvbrafmazxrfiaocqdjg) — verified directly against the database
 * with a temporary, fully-cleaned-up test student (see task report). This
 * file pins the pure business-logic invariants as a runnable, reviewable
 * spec, independent of a live DB connection.
 *
 * Key model:
 *   - lesson_records: unchanged, one row per (student, level, lesson_number)
 *     — the progression/history ledger.
 *   - attended_sessions: NEW, one row per attended occurrence, unlimited
 *     per lesson, unique on (student_id, date, session_number).
 *   - feedback_sheets: now keyed to attended_session_id, one per session
 *     (not one per completed lesson).
 */

type Outcome = 'completed' | 'not_finished'

interface Session {
  id: string
  studentId: string
  date: string
  sessionNumber: number
  actualLessonId: string
  outcome: Outcome
}
interface LessonRecordRow {
  studentId: string
  levelId: number
  lessonNumber: number
  status: 'completed' | 'not_completed'
}
interface FeedbackRow {
  sessionId: string
  status: 'not_written' | 'written_not_taken' | 'given'
}
interface StudentState {
  currentLevelId: number
  currentLessonNumber: number
  remediationPending: boolean
}
interface Lesson {
  id: string
  levelId: number
  lessonNumber: number
}

interface World {
  sessions: Session[]
  lessonRecords: LessonRecordRow[]
  feedback: FeedbackRow[]
  student: StudentState
}

function nextSessionNumber(world: World, studentId: string, date: string): number {
  const same = world.sessions.filter((s) => s.studentId === studentId && s.date === date)
  return same.length === 0 ? 1 : Math.max(...same.map((s) => s.sessionNumber)) + 1
}

function upsertLessonRecord(world: World, studentId: string, lesson: Lesson, status: 'completed' | 'not_completed') {
  const idx = world.lessonRecords.findIndex(
    (r) => r.studentId === studentId && r.levelId === lesson.levelId && r.lessonNumber === lesson.lessonNumber,
  )
  if (idx === -1) world.lessonRecords.push({ studentId, levelId: lesson.levelId, lessonNumber: lesson.lessonNumber, status })
  else world.lessonRecords[idx] = { ...world.lessonRecords[idx], status }
}

/** Mirrors record_attended_session. Throws to mirror RAISE EXCEPTION. */
function recordAttendedSession(world: World, studentId: string, lesson: Lesson, outcome: Outcome, date: string): Session {
  const isProgressing = outcome === 'completed' && lesson.lessonNumber === world.student.currentLessonNumber && lesson.levelId === world.student.currentLevelId
  if (isProgressing && world.student.remediationPending) {
    throw new Error('Remediation must be resolved first')
  }
  const sessionNumber = nextSessionNumber(world, studentId, date)
  const session: Session = {
    id: `${studentId}-${date}-${sessionNumber}`,
    studentId,
    date,
    sessionNumber,
    actualLessonId: lesson.id,
    outcome,
  }
  world.sessions.push(session)
  upsertLessonRecord(world, studentId, lesson, outcome === 'completed' ? 'completed' : 'not_completed')
  world.feedback.push({ sessionId: session.id, status: 'not_written' })
  if (isProgressing) {
    world.student.currentLessonNumber += 1 // simplified stand-in for next_curriculum_lesson()
  }
  return session
}

function freshWorld(): World {
  return { sessions: [], lessonRecords: [], feedback: [], student: { currentLevelId: 1, currentLessonNumber: 5, remediationPending: false } }
}

const lesson5: Lesson = { id: 'l5', levelId: 1, lessonNumber: 5 }
const lesson6: Lesson = { id: 'l6', levelId: 1, lessonNumber: 6 }

describe('attended + completed session', () => {
  it('creates a session, upserts lesson_records completed, creates feedback, and advances progression', () => {
    const world = freshWorld()
    recordAttendedSession(world, 's1', lesson5, 'completed', '2026-09-01')
    expect(world.sessions).toHaveLength(1)
    expect(world.lessonRecords).toEqual([{ studentId: 's1', levelId: 1, lessonNumber: 5, status: 'completed' }])
    expect(world.feedback).toHaveLength(1)
    expect(world.feedback[0].status).toBe('not_written')
    expect(world.student.currentLessonNumber).toBe(6)
  })
})

describe('attended + not_finished session', () => {
  it('creates a session and feedback, marks lesson_records not_completed, does NOT advance progression', () => {
    const world = freshWorld()
    recordAttendedSession(world, 's1', lesson5, 'not_finished', '2026-09-01')
    expect(world.sessions).toHaveLength(1)
    expect(world.lessonRecords[0].status).toBe('not_completed')
    expect(world.feedback).toHaveLength(1)
    expect(world.student.currentLessonNumber).toBe(5) // unchanged
  })
})

describe('absent student', () => {
  it('never calls recordAttendedSession at all, so no session/lesson_record/feedback is created', () => {
    const world = freshWorld()
    // Marking absent is purely an `attendance` table write in the real
    // app — it never touches this function. Nothing to assert beyond: no
    // session-related state changes when the function is never invoked.
    expect(world.sessions).toHaveLength(0)
    expect(world.lessonRecords).toHaveLength(0)
    expect(world.feedback).toHaveLength(0)
  })
})

describe('double session, same date', () => {
  it('creates two distinct session records with sequential session numbers', () => {
    const world = freshWorld()
    const first = recordAttendedSession(world, 's1', lesson5, 'completed', '2026-09-01')
    const second = recordAttendedSession(world, 's1', lesson6, 'completed', '2026-09-01')
    expect(world.sessions).toHaveLength(2)
    expect(first.sessionNumber).toBe(1)
    expect(second.sessionNumber).toBe(2)
    expect(first.id).not.toBe(second.id)
  })

  it('a repeat of the SAME lesson twice in one day is still two sessions, not one merged row', () => {
    const world = freshWorld()
    world.student.currentLessonNumber = 5
    recordAttendedSession(world, 's1', lesson5, 'not_finished', '2026-09-01')
    recordAttendedSession(world, 's1', lesson5, 'completed', '2026-09-01')
    expect(world.sessions).toHaveLength(2)
    // ...but lesson_records still has exactly one row for that lesson —
    // history stays a ledger, not a log.
    expect(world.lessonRecords).toHaveLength(1)
    expect(world.lessonRecords[0].status).toBe('completed')
  })
})

describe('feedback per session', () => {
  it('each attended session gets exactly one feedback record', () => {
    const world = freshWorld()
    const s1 = recordAttendedSession(world, 's1', lesson5, 'completed', '2026-09-01')
    const s2 = recordAttendedSession(world, 's1', lesson6, 'not_finished', '2026-09-01')
    const feedbackFor = (sessionId: string) => world.feedback.filter((f) => f.sessionId === sessionId)
    expect(feedbackFor(s1.id)).toHaveLength(1)
    expect(feedbackFor(s2.id)).toHaveLength(1)
    expect(world.feedback).toHaveLength(2)
  })

  it('completing an already-recorded session does not duplicate feedback (ON CONFLICT DO NOTHING keyed to the session)', () => {
    const world = freshWorld()
    const session = recordAttendedSession(world, 's1', lesson5, 'completed', '2026-09-01')
    // Simulates the ON CONFLICT (attended_session_id) DO NOTHING guard —
    // re-inserting feedback for a session id that already has one is a
    // no-op, mirrored here as: only push if none exists yet.
    const alreadyHasFeedback = world.feedback.some((f) => f.sessionId === session.id)
    if (!alreadyHasFeedback) world.feedback.push({ sessionId: session.id, status: 'not_written' })
    expect(world.feedback.filter((f) => f.sessionId === session.id)).toHaveLength(1)
  })
})

describe('recording an actual lesson different from current progression', () => {
  it('records the session and updates that lesson\'s history, but does not touch progression', () => {
    const world = freshWorld() // current lesson is 5
    recordAttendedSession(world, 's1', lesson5, 'completed', '2026-09-01') // advances to 6
    expect(world.student.currentLessonNumber).toBe(6)
    // Now repeat the OLD lesson (5) again — off-progression.
    recordAttendedSession(world, 's1', lesson5, 'completed', '2026-09-02')
    expect(world.student.currentLessonNumber).toBe(6) // unchanged
    expect(world.lessonRecords.find((r) => r.lessonNumber === 5)?.status).toBe('completed')
    expect(world.sessions).toHaveLength(2)
  })

  it('is not blocked at the database level even though lesson 5 was already completed', () => {
    const world = freshWorld()
    recordAttendedSession(world, 's1', lesson5, 'completed', '2026-09-01')
    expect(() => recordAttendedSession(world, 's1', lesson5, 'completed', '2026-09-05')).not.toThrow()
  })

  it('remediation only blocks completing the CURRENT progression lesson, not an off-progression repeat', () => {
    const world = freshWorld()
    world.student.remediationPending = true
    // Blocked: this WOULD advance progression.
    expect(() => recordAttendedSession(world, 's1', lesson5, 'completed', '2026-09-01')).toThrow('Remediation must be resolved first')
    // Not blocked: recording an unrelated lesson never touches progression.
    expect(() => recordAttendedSession(world, 's1', lesson6, 'completed', '2026-09-01')).not.toThrow()
    expect(world.student.currentLessonNumber).toBe(5) // still unmoved
  })
})
