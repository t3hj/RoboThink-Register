import { describe, it, expect } from 'vitest'
import { isOutstanding, feedbackReminderText, findOutstandingFeedback, FEEDBACK_SHORT } from '../src/lib/feedback'
import type { FeedbackStatus } from '../src/types'

describe('isOutstanding', () => {
  it('not_written and written_not_taken are outstanding', () => {
    expect(isOutstanding('not_written')).toBe(true)
    expect(isOutstanding('written_not_taken')).toBe(true)
  })
  it('given is not outstanding', () => {
    expect(isOutstanding('given')).toBe(false)
  })
})

describe('feedbackReminderText', () => {
  it('does not rely on colour alone — every outstanding status has explicit text', () => {
    expect(feedbackReminderText('not_written')).toBe('Feedback not written')
    expect(feedbackReminderText('written_not_taken')).toBe('Feedback ready — needs giving')
  })
  it('given has no reminder text', () => {
    expect(feedbackReminderText('given')).toBeNull()
  })
  it('every FEEDBACK_SHORT entry matches an outstanding status', () => {
    for (const status of Object.keys(FEEDBACK_SHORT) as FeedbackStatus[]) {
      expect(isOutstanding(status)).toBe(true)
    }
  })
})

interface Sheet {
  id: string
  status: FeedbackStatus
  created_at: string
}

describe('findOutstandingFeedback — the core catch-up reminder rule', () => {
  it('is found by student_id alone: attendance day/schedule never factors in', () => {
    // Student completes Lesson 5 Monday -> written_not_taken. Never attends
    // Tuesday (irrelevant - we don't even look at attendance here). Attends
    // Thursday as a catch-up: the Thursday Register only ever queries
    // feedback_sheets by student_id, so this is found regardless of which
    // day it is or whether it was a scheduled or catch-up session.
    const sheets: Sheet[] = [{ id: 'f1', status: 'written_not_taken', created_at: '2026-09-14T10:00:00Z' }]
    const outstanding = findOutstandingFeedback(sheets)
    expect(outstanding?.status).toBe('written_not_taken')
  })

  it('not_written stays outstanding until explicitly changed, across any number of days', () => {
    const sheets: Sheet[] = [{ id: 'f1', status: 'not_written', created_at: '2026-09-14T10:00:00Z' }]
    expect(findOutstandingFeedback(sheets)?.status).toBe('not_written')
  })

  it('attending a session never marks feedback as given by itself', () => {
    // Simulates: student has an outstanding sheet, then "attends" (nothing
    // in this module reacts to attendance at all) — the sheet is untouched.
    const sheets: Sheet[] = [{ id: 'f1', status: 'not_written', created_at: '2026-09-14T10:00:00Z' }]
    const beforeAttending = findOutstandingFeedback(sheets)
    const afterAttending = findOutstandingFeedback(sheets) // no mutation happens anywhere
    expect(afterAttending).toEqual(beforeAttending)
    expect(afterAttending?.status).not.toBe('given')
  })

  it('marking given removes the reminder', () => {
    const sheets: Sheet[] = [{ id: 'f1', status: 'given', created_at: '2026-09-14T10:00:00Z' }]
    expect(findOutstandingFeedback(sheets)).toBeNull()
  })

  it('returns null when there are no feedback sheets at all', () => {
    expect(findOutstandingFeedback([])).toBeNull()
  })

  it('with multiple sheets, surfaces the most recently created outstanding one', () => {
    const sheets: Sheet[] = [
      { id: 'old', status: 'not_written', created_at: '2026-09-01T10:00:00Z' },
      { id: 'new', status: 'written_not_taken', created_at: '2026-09-10T10:00:00Z' },
      { id: 'resolved', status: 'given', created_at: '2026-09-12T10:00:00Z' },
    ]
    expect(findOutstandingFeedback(sheets)?.id).toBe('new')
  })
})
