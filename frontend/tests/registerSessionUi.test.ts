import { describe, it, expect } from 'vitest'
import {
  attendanceState,
  nearbyLessonNumbers,
  outcomeToAttendanceStatus,
  registerCompleteness,
  needsLeftAsideReminder,
  validateLeftAside,
  previouslyCompletedWarningDate,
  saveOperationFor,
  NOT_FINISHED_REASONS,
} from '../src/lib/attendedSessionsUi'

describe('attendanceState — Not entered / Attended / Absent are distinguishable', () => {
  it('no attendance row at all is "not entered"', () => {
    expect(attendanceState(null)).toBe('not_entered')
    expect(attendanceState(undefined)).toBe('not_entered')
  })
  it('a row still sitting at "Not Arrived" (e.g. from Add to Register) is also "not entered"', () => {
    expect(attendanceState('Not Arrived')).toBe('not_entered')
  })
  it('Arrived or Completed both read as "attended"', () => {
    expect(attendanceState('Arrived')).toBe('attended')
    expect(attendanceState('Completed')).toBe('attended')
  })
  it('Absent is its own distinct state', () => {
    expect(attendanceState('Absent')).toBe('absent')
  })
})

describe('outcomeToAttendanceStatus', () => {
  it('completed maps to Completed, not_finished maps to Arrived', () => {
    expect(outcomeToAttendanceStatus('completed')).toBe('Completed')
    expect(outcomeToAttendanceStatus('not_finished')).toBe('Arrived')
  })
})

describe('nearbyLessonNumbers — keeps the default picker small, not the whole curriculum', () => {
  it('returns lessons around the current one, excluding the current lesson itself', () => {
    expect(nearbyLessonNumbers(6, 12, 2)).toEqual([4, 5, 7, 8])
  })
  it('clips at the start of the curriculum', () => {
    expect(nearbyLessonNumbers(1, 12, 2)).toEqual([2, 3])
  })
  it('clips at the end of the curriculum', () => {
    expect(nearbyLessonNumbers(12, 12, 2)).toEqual([10, 11])
  })
})

describe('registerCompleteness — recorded vs unrecorded active students', () => {
  it('counts Attended and Absent as recorded, "not entered" as unrecorded', () => {
    const rows = [{ status: 'Arrived' as const }, { status: 'Absent' as const }, { status: null }, { status: 'Not Arrived' as const }]
    const result = registerCompleteness(rows)
    expect(result).toEqual({ recorded: 2, total: 4, notEntered: 2 })
  })
  it('an empty roster is 0/0', () => {
    expect(registerCompleteness([])).toEqual({ recorded: 0, total: 0, notEntered: 0 })
  })
  it('all recorded means zero not-entered', () => {
    const rows = [{ status: 'Completed' as const }, { status: 'Absent' as const }]
    expect(registerCompleteness(rows)).toEqual({ recorded: 2, total: 2, notEntered: 0 })
  })
})

describe('needsLeftAsideReminder — follows the student regardless of date/schedule', () => {
  it('fires when the most recent session was not_finished with a build left aside', () => {
    expect(needsLeftAsideReminder({ outcome: 'not_finished', left_aside: true })).toBe(true)
  })
  it('does not fire if nothing was left aside', () => {
    expect(needsLeftAsideReminder({ outcome: 'not_finished', left_aside: false })).toBe(false)
  })
  it('does not fire once the most recent session is completed (a later session supersedes it)', () => {
    expect(needsLeftAsideReminder({ outcome: 'completed', left_aside: false })).toBe(false)
  })
  it('handles no session history at all', () => {
    expect(needsLeftAsideReminder(null)).toBe(false)
    expect(needsLeftAsideReminder(undefined)).toBe(false)
  })
})

describe('validateLeftAside — Not Finished build/laptop identifier + reason validation', () => {
  it('no validation needed when nothing was left aside', () => {
    expect(validateLeftAside({ leftAside: false, identifier: '', reason: '', note: '' })).toBeNull()
  })
  it('requires an identifier when left aside is checked', () => {
    expect(validateLeftAside({ leftAside: true, identifier: '', reason: 'sensor_issue', note: '' })).toMatch(/identifier/i)
  })
  it('accepts alphanumeric identifiers like B12, Laptop 7, 23, Build A', () => {
    for (const id of ['23', 'B12', 'Laptop 7', 'Build A']) {
      expect(validateLeftAside({ leftAside: true, identifier: id, reason: 'sensor_issue', note: '' })).toBeNull()
    }
  })
  it('requires a reason when left aside is checked', () => {
    expect(validateLeftAside({ leftAside: true, identifier: 'B12', reason: '', note: '' })).toMatch(/reason/i)
  })
  it('requires a note when the reason is Other', () => {
    expect(validateLeftAside({ leftAside: true, identifier: 'B12', reason: 'other', note: '' })).toMatch(/note/i)
    expect(validateLeftAside({ leftAside: true, identifier: 'B12', reason: 'other', note: 'left wheel jammed' })).toBeNull()
  })
  it('does not require a note for non-Other reasons', () => {
    expect(validateLeftAside({ leftAside: true, identifier: 'B12', reason: 'motors_not_working', note: '' })).toBeNull()
  })
  it('exposes all 8 fixed reasons including Other', () => {
    expect(NOT_FINISHED_REASONS.map((r) => r.value)).toEqual([
      'motors_not_working',
      'sensor_issue',
      'missing_pieces',
      'build_incomplete',
      'coding_incomplete',
      'ran_out_of_time',
      'needed_help',
      'other',
    ])
  })
})

describe('previouslyCompletedWarningDate — non-blocking repeat warning', () => {
  const completed = new Map([[5, '2026-09-01']])

  it('returns the completion date when the chosen lesson was already completed', () => {
    expect(previouslyCompletedWarningDate(5, completed, false)).toBe('2026-09-01')
  })
  it('returns null for a lesson never completed before', () => {
    expect(previouslyCompletedWarningDate(6, completed, false)).toBeNull()
  })
  it('does not warn when editing a session for the exact lesson it already was', () => {
    expect(previouslyCompletedWarningDate(5, completed, true)).toBeNull()
  })
  it('the warning never blocks saving — it is purely informational (no exception, just a value)', () => {
    expect(() => previouslyCompletedWarningDate(5, completed, false)).not.toThrow()
  })
})

describe('saveOperationFor — reopening an existing session updates it, never duplicates', () => {
  it('no session being edited -> insert (a fresh session)', () => {
    expect(saveOperationFor(null)).toBe('insert')
  })
  it('an existing session id -> update (the same session, not a new one)', () => {
    expect(saveOperationFor('session-123')).toBe('update')
  })
})
