import { describe, it, expect } from 'vitest'
import { attendancePercentage, attendanceFlag, isExpectedOn, countByStatus, sessionTimeBreakdown, groupAttendanceByMonth } from '../src/lib/attendanceStats'

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

describe('groupAttendanceByMonth', () => {
  it('buckets by calendar month, newest month first, newest date first within a month', () => {
    const rows = [
      { date: '2026-09-01' },
      { date: '2026-09-15' },
      { date: '2026-08-25' },
    ]
    const result = groupAttendanceByMonth(rows)
    expect(result.map((g) => g.month)).toEqual(['September 2026', 'August 2026'])
    expect(result[0].rows.map((r) => r.date)).toEqual(['2026-09-15', '2026-09-01'])
  })

  it('handles an empty list', () => {
    expect(groupAttendanceByMonth([])).toEqual([])
  })
})

describe('sessionTimeBreakdown — computed from actual schedule data, never hard-coded', () => {
  it('splits weekday vs weekend by preferred_day, grouping by preferred_time', () => {
    const students = [
      { preferred_day: 'Monday', preferred_time: '16:00' },
      { preferred_day: 'Tuesday', preferred_time: '16:00' },
      { preferred_day: 'Wednesday', preferred_time: '17:00' },
      { preferred_day: 'Saturday', preferred_time: '09:00' },
      { preferred_day: 'Saturday', preferred_time: '10:00' },
      { preferred_day: 'Sunday', preferred_time: '10:00' },
    ]
    const result = sessionTimeBreakdown(students)
    expect(result.weekday).toEqual([{ label: '16:00', count: 2 }, { label: '17:00', count: 1 }])
    expect(result.weekend).toEqual([{ label: '09:00', count: 1 }, { label: '10:00', count: 2 }])
  })

  it('ignores students with no day or no time set', () => {
    const result = sessionTimeBreakdown([
      { preferred_day: null, preferred_time: '16:00' },
      { preferred_day: 'Monday', preferred_time: null },
    ])
    expect(result.weekday).toEqual([])
    expect(result.weekend).toEqual([])
  })

  it('reflects new times as soon as they appear in the data, with no hard-coded list', () => {
    const result = sessionTimeBreakdown([{ preferred_day: 'Monday', preferred_time: '18:30' }])
    expect(result.weekday).toEqual([{ label: '18:30', count: 1 }])
  })
})
