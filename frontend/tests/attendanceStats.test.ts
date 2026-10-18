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

import { classifyAttendance, summariseAttendance, isExpectedOnDate, findUnmarkedSessions } from '../src/lib/attendanceStats'
import type { Student } from '../src/types'

const row = (date: string, status: 'Arrived' | 'Completed' | 'Absent' | 'Not Arrived', session_type: 'regular' | 'catch_up' | 'special' = 'regular') => ({
  date,
  status,
  session_type,
})

describe('make-up sessions', () => {
  it('an absence made up by a later catch-up is not a miss and the catch-up does not inflate the rate', () => {
    const rows = [row('2026-09-01', 'Completed'), row('2026-09-08', 'Absent'), row('2026-09-12', 'Completed', 'catch_up'), row('2026-09-15', 'Completed')]
    expect(summariseAttendance(rows)).toEqual({ attended: 2, missed: 0, madeUp: 1, extra: 1 })
    expect(attendancePercentage(rows)).toBe(100)
  })

  it('an unmade-up absence still counts against the student', () => {
    const rows = [row('2026-09-01', 'Completed'), row('2026-09-08', 'Absent'), row('2026-09-15', 'Completed')]
    expect(attendancePercentage(rows)).toBe(67)
  })

  it('each catch-up makes up only one absence', () => {
    const rows = [row('2026-09-01', 'Absent'), row('2026-09-08', 'Absent'), row('2026-09-10', 'Completed', 'catch_up')]
    const kinds = classifyAttendance(rows).map((r) => r.kind)
    expect(kinds.filter((k) => k === 'made_up')).toHaveLength(1)
    expect(kinds.filter((k) => k === 'missed')).toHaveLength(1)
  })

  it('a catch-up the week BEFORE the absence counts (fortnightly doubling up)', () => {
    const rows = [row('2026-09-02', 'Completed', 'catch_up'), row('2026-09-08', 'Absent')]
    expect(summariseAttendance(rows).missed).toBe(0)
  })

  it('a catch-up far outside the window does not hide an absence', () => {
    const rows = [row('2026-09-01', 'Absent'), row('2026-10-20', 'Completed', 'catch_up')]
    expect(summariseAttendance(rows).missed).toBe(1)
  })

  it('a bonus catch-up with no absence never raises the percentage', () => {
    const rows = [row('2026-09-01', 'Completed'), row('2026-09-08', 'Absent'), row('2026-09-30', 'Completed', 'special')]
    expect(attendancePercentage(rows)).toBe(50)
  })

  it('a made-up absence does not trigger the missed flags', () => {
    const rows = [row('2026-09-10', 'Absent'), row('2026-09-12', 'Completed', 'catch_up'), row('2026-09-03', 'Completed')]
    expect(attendanceFlag({ rows, today: '2026-09-14', hasSchedule: true })).toBeNull()
  })
})

describe('fortnightly students', () => {
  const base = { preferred_day: 'Tuesday' as string | null, attendance_pattern: 'fortnightly' as const, fortnight_anchor: '2026-09-01' }

  it('is expected every second week on the normal day only', () => {
    expect(isExpectedOnDate(base, '2026-09-01')).toBe(true)
    expect(isExpectedOnDate(base, '2026-09-08')).toBe(false)
    expect(isExpectedOnDate(base, '2026-09-15')).toBe(true)
    expect(isExpectedOnDate(base, '2026-09-16')).toBe(false) // wrong weekday
  })

  it('works before the anchor and across a year boundary', () => {
    expect(isExpectedOnDate(base, '2026-08-18')).toBe(true)
    expect(isExpectedOnDate(base, '2026-08-25')).toBe(false)
    expect(isExpectedOnDate({ ...base, fortnight_anchor: '2026-12-29' }, '2027-01-12')).toBe(true)
    expect(isExpectedOnDate({ ...base, fortnight_anchor: '2026-12-29' }, '2027-01-05')).toBe(false)
  })

  it('anchor can be any day of the on-week', () => {
    expect(isExpectedOnDate({ ...base, fortnight_anchor: '2026-09-04' }, '2026-09-15')).toBe(true)
  })

  it('weekly students and fortnightly students without an anchor are expected every week', () => {
    expect(isExpectedOnDate({ preferred_day: 'Tuesday' }, '2026-09-08')).toBe(true)
    expect(isExpectedOnDate({ ...base, fortnight_anchor: null }, '2026-09-08')).toBe(true)
  })

  it('tolerates a longer gap before flagging silence', () => {
    const rows = [row('2026-08-10', 'Completed')]
    expect(attendanceFlag({ rows, today: '2026-09-14', hasSchedule: true })).toBe('no_attendance_recently')
    expect(attendanceFlag({ rows, today: '2026-09-14', hasSchedule: true, frequency: 'fortnightly' })).toBe('no_attendance_recently')
    expect(attendanceFlag({ rows: [row('2026-08-20', 'Completed')], today: '2026-09-14', hasSchedule: true, frequency: 'fortnightly' })).toBeNull()
  })
})

describe('findUnmarkedSessions', () => {
  const student = (id: string, over: Partial<Student> = {}) =>
    ({ id, full_name: id, active: true, centre_id: 'c1', preferred_day: 'Tuesday', date_joined: '2026-01-01', ...over }) as Student

  it('lists an expected student with no row on a day the register was used', () => {
    const students = [student('amy'), student('ben')]
    const out = findUnmarkedSessions(students, [{ student_id: 'amy', date: '2026-09-08' }], '2026-09-01', '2026-09-14')
    expect(out.map((o) => `${o.student.id}@${o.date}`)).toEqual(['ben@2026-09-08'])
  })

  it('ignores days nobody at the centre was marked (closures/holidays)', () => {
    const out = findUnmarkedSessions([student('amy')], [], '2026-09-01', '2026-09-14')
    expect(out).toEqual([])
  })

  it('skips off-week fortnightly students, inactive students and dates before they joined', () => {
    const students = [
      student('amy'),
      student('fort', { attendance_pattern: 'fortnightly', fortnight_anchor: '2026-09-01' }),
      student('gone', { active: false }),
      student('new', { date_joined: '2026-09-10' }),
    ]
    const out = findUnmarkedSessions(students, [{ student_id: 'amy', date: '2026-09-08' }], '2026-09-08', '2026-09-08')
    expect(out).toEqual([])
  })
})
