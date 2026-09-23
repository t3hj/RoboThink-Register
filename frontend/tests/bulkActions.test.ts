import { describe, it, expect } from 'vitest'
import {
  eligibleForMarkAttended,
  eligibleForMarkAbsent,
  eligibleForSession,
  eligibleForFeedback,
  mostCommonLessonId,
  resolveFeedbackTarget,
  summarizeBulkResults,
  type BulkCandidate,
} from '../src/lib/bulkActions'

function candidate(overrides: Partial<BulkCandidate> = {}): BulkCandidate {
  return { id: 's1', full_name: 'Student', status: null, sessionCount: 0, ...overrides }
}

describe('eligibleForMarkAttended — bulk Mark Attended', () => {
  it('skips students already Attended (Arrived or Completed)', () => {
    const candidates = [
      candidate({ id: 'a', status: 'Not Arrived' }),
      candidate({ id: 'b', status: 'Arrived' }),
      candidate({ id: 'c', status: 'Completed' }),
      candidate({ id: 'd', status: 'Absent' }),
    ]
    const { eligible, skipped } = eligibleForMarkAttended(candidates)
    expect(eligible.map((c) => c.id)).toEqual(['a', 'd'])
    expect(skipped.map((s) => s.candidate.id)).toEqual(['b', 'c'])
  })
})

describe('eligibleForMarkAbsent — bulk Mark Absent', () => {
  it('skips students already Absent; does not care about existing sessions', () => {
    const candidates = [
      candidate({ id: 'a', status: 'Absent' }),
      candidate({ id: 'b', status: 'Arrived', sessionCount: 2 }),
      candidate({ id: 'c', status: null }),
    ]
    const { eligible, skipped } = eligibleForMarkAbsent(candidates)
    expect(eligible.map((c) => c.id)).toEqual(['b', 'c'])
    expect(skipped.map((s) => s.candidate.id)).toEqual(['a'])
  })
})

describe('eligibleForSession — bulk Lesson/Outcome and bulk Not Finished share this', () => {
  it('only Attended students are eligible', () => {
    const candidates = [
      candidate({ id: 'a', status: 'Arrived' }),
      candidate({ id: 'b', status: 'Completed' }),
      candidate({ id: 'c', status: 'Absent' }),
      candidate({ id: 'd', status: null }),
    ]
    const { eligible, skipped } = eligibleForSession(candidates)
    expect(eligible.map((c) => c.id)).toEqual(['a', 'b'])
    expect(skipped.map((s) => s.candidate.id)).toEqual(['c', 'd'])
    expect(skipped.every((s) => s.reason.length > 0)).toBe(true)
  })
})

describe('eligibleForFeedback — bulk feedback', () => {
  it('only students with an existing session for the date are eligible', () => {
    const candidates = [candidate({ id: 'a', sessionCount: 1 }), candidate({ id: 'b', sessionCount: 0 }), candidate({ id: 'c', sessionCount: 2 })]
    const { eligible, skipped } = eligibleForFeedback(candidates)
    expect(eligible.map((c) => c.id)).toEqual(['a', 'c'])
    expect(skipped.map((s) => s.candidate.id)).toEqual(['b'])
  })
})

describe('mostCommonLessonId — bulk "Recommended" lesson', () => {
  it('picks the most frequent current lesson among selected students', () => {
    expect(mostCommonLessonId(['l5', 'l5', 'l6'])).toBe('l5')
  })
  it('ignores nulls (students with no current lesson)', () => {
    expect(mostCommonLessonId([null, 'l5', null])).toBe('l5')
  })
  it('returns null when nobody has a current lesson', () => {
    expect(mostCommonLessonId([null, null])).toBeNull()
  })
})

describe('resolveFeedbackTarget — feedback must hit only the correct session', () => {
  it('targets the single session when there is only one', () => {
    const result = resolveFeedbackTarget(
      [{ id: 'sess-1', session_number: 1 }],
      [{ id: 'fb-1', attended_session_id: 'sess-1' }],
    )
    expect(result).toEqual({ targetSessionNumber: 1, feedbackId: 'fb-1' })
  })

  it('with Session 1 and Session 2 on the same date, targets Session 2 (the most recent) and its own feedback only', () => {
    const sessions = [
      { id: 'sess-1', session_number: 1 },
      { id: 'sess-2', session_number: 2 },
    ]
    const feedback = [
      { id: 'fb-1', attended_session_id: 'sess-1' },
      { id: 'fb-2', attended_session_id: 'sess-2' },
    ]
    const result = resolveFeedbackTarget(sessions, feedback)
    expect(result.targetSessionNumber).toBe(2)
    expect(result.feedbackId).toBe('fb-2')
    // Session 1's feedback must never be the one selected.
    expect(result.feedbackId).not.toBe('fb-1')
  })

  it('returns nulls when the student has no session that date', () => {
    expect(resolveFeedbackTarget([], [])).toEqual({ targetSessionNumber: null, feedbackId: null })
  })

  it('handles a session that has no matching feedback row yet (defensive edge case)', () => {
    const result = resolveFeedbackTarget([{ id: 'sess-1', session_number: 1 }], [])
    expect(result).toEqual({ targetSessionNumber: 1, feedbackId: null })
  })
})

describe('summarizeBulkResults — honest partial-failure reporting', () => {
  it('reports every success when all succeed', () => {
    const items = [{ id: 'a', name: 'Alice' }, { id: 'b', name: 'Bob' }]
    const results: PromiseSettledResult<unknown>[] = [
      { status: 'fulfilled', value: undefined },
      { status: 'fulfilled', value: undefined },
    ]
    expect(summarizeBulkResults(items, results)).toEqual({ succeeded: ['a', 'b'], failed: [] })
  })

  it('never claims full success when some failed', () => {
    const items = [{ id: 'a', name: 'Alice' }, { id: 'b', name: 'Bob' }]
    const results: PromiseSettledResult<unknown>[] = [
      { status: 'fulfilled', value: undefined },
      { status: 'rejected', reason: new Error('network blip') },
    ]
    const summary = summarizeBulkResults(items, results)
    expect(summary.succeeded).toEqual(['a'])
    expect(summary.failed).toEqual([{ id: 'b', name: 'Bob', message: 'network blip' }])
  })
})
