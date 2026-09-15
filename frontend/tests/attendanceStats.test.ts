import { describe, it, expect } from 'vitest'
import { attendancePercentage, attendanceFlag, isExpectedOn, countByStatus } from '../src/lib/attendanceStats'

describe('attendancePercentage', () => {
  it('counts only Arrived/Completed as attended and Absent as missed', () => {
    expect(
      attendancePercentage([{ status: 'Completed' }, { status: 'Arrived' }, { status: 'Absent' }, { status: 'Not Arrived' }]),
    ).toBe(67)
  })
  it('returns null with no relevant rows', () => {
    expect(attendancePercentage([])).toBeNull()
    expect(attendancePercentage([{ status: 'Not Arrived' }])).toBeNull()
  })
})

describe('attendanceFlag — never a single miss = dropout', () => {
  it('one missed session alone only gets "missed recently", not the stronger flag', () => {
    const rows = [{ status: 'Absent' as const, date: '2026-09-10' }, { status: 'Completed' as const, date: '2026-09-03' }]
    expect(attendanceFlag({ rows, today: '2026-09-14', hasSchedule: true })).toBe('missed_recently')
  })

  it('two or more misses in the last three sessions escalates the flag', () => {
    const rows = [
      { status: 'Absent' as const, date: '2026-09-10' },
      { status: 'Absent' as const, date: '2026-09-03' },
      { status: 'Completed' as const, date: '2026-08-27' },
    ]
    expect(attendanceFlag({ rows, today: '2026-09-14', hasSchedule: true })).toBe('several_recent_missed')
  })

  it('no attendance rows at all but has a schedule -> no_attendance_recently (fully quiet)', () => {
    expect(attendanceFlag({ rows: [], today: '2026-09-14', hasSchedule: true })).toBe('no_attendance_recently')
  })

  it('long silence after a normal completed session -> no_attendance_recently', () => {
    const rows = [{ status: 'Completed' as const, date: '2026-08-01' }]
    expect(attendanceFlag({ rows, today: '2026-09-14', hasSchedule: true })).toBe('no_attendance_recently')
  })

  it('recent completed session -> no flag', () => {
    const rows = [{ status: 'Completed' as const, date: '2026-09-13' }]
    expect(attendanceFlag({ rows, today: '2026-09-14', hasSchedule: true })).toBeNull()
  })

  it('does not flag silence for a student with no fixed schedule', () => {
    expect(attendanceFlag({ rows: [], today: '2026-09-14', hasSchedule: false })).toBeNull()
  })
})

describe('isExpectedOn', () => {
  it('matches only the student\'s actual preferred day', () => {
    expect(isExpectedOn('Tuesday', 'Tuesday')).toBe(true)
    expect(isExpectedOn('Tuesday', 'Monday')).toBe(false)
    expect(isExpectedOn(null, 'Monday')).toBe(false)
  })
})

describe('countByStatus', () => {
  it('tallies every status bucket, including zero counts', () => {
    expect(countByStatus([{ status: 'Arrived' }, { status: 'Arrived' }, { status: 'Absent' }])).toEqual({
      'Not Arrived': 0,
      Arrived: 2,
      Absent: 1,
      Completed: 0,
    })
  })
})
