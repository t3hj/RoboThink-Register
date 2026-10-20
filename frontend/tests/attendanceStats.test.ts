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

  it('has no deadline: a make-up months later still cancels the absence', () => {
    const rows = [row('2026-09-01', 'Absent'), row('2027-01-20', 'Completed', 'catch_up')]
    expect(summariseAttendance(rows).missed).toBe(0)
  })

  it('a catch-up more than a week BEFORE the absence does not cover it', () => {
    const rows = [row('2026-08-01', 'Completed', 'catch_up'), row('2026-09-01', 'Absent')]
    expect(summariseAttendance(rows).missed).toBe(1)
  })

  it('a bonus catch-up with no absence never raises the percentage', () => {
    const rows = [row('2026-08-01', 'Completed', 'special'), row('2026-09-01', 'Completed'), row('2026-09-08', 'Absent')]
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

import { summariseRange } from '../src/lib/attendanceStats'
import { closureName, isClosedDay } from '../src/lib/ukHolidays'

describe('summariseRange', () => {
  it('matches a make-up in the next period instead of reporting a miss', () => {
    const rows = [row('2026-09-06', 'Absent'), row('2026-09-09', 'Completed', 'catch_up')]
    expect(summariseRange(rows, '2026-08-31', '2026-09-06').missed).toBe(0)
  })
})

describe('England & Wales closures', () => {
  it('knows the 2026 bank holidays', () => {
    expect(closureName('2026-01-01')).toBe("New Year's Day")
    expect(closureName('2026-04-03')).toBe('Good Friday')
    expect(closureName('2026-04-06')).toBe('Easter Monday')
    expect(closureName('2026-05-04')).toBe('Early May bank holiday')
    expect(closureName('2026-05-25')).toBe('Spring bank holiday')
    expect(closureName('2026-08-31')).toBe('Summer bank holiday')
    expect(closureName('2026-12-25')).toBe('Christmas Day')
    expect(closureName('2026-12-28')).toBe('Boxing Day') // 26th is a Saturday
  })

  it('applies substitute days and other years', () => {
    expect(closureName('2027-12-27')).toBe('Christmas Day') // 25th is a Saturday
    expect(closureName('2027-12-28')).toBe('Boxing Day')
    expect(closureName('2028-01-03')).toBe("New Year's Day") // 1st is a Saturday
    expect(closureName('2027-03-26')).toBe('Good Friday')
    expect(closureName('2027-05-31')).toBe('Spring bank holiday')
  })

  it('treats ordinary days as open', () => {
    expect(isClosedDay('2026-10-19')).toBe(false)
    expect(isClosedDay('2026-12-24')).toBe(false)
  })

  it('nobody is expected on a closure day, so nothing is flagged unmarked', () => {
    const s = { preferred_day: 'Monday' }
    expect(isExpectedOnDate(s, '2026-12-28')).toBe(false)
    expect(isExpectedOnDate(s, '2026-12-21')).toBe(true)
  })
})

import { weeklySlots, slotOnDate, describeSlots } from '../src/lib/attendanceStats'

describe('students with several weekly sessions', () => {
  const nia = {
    preferred_day: 'Sunday',
    preferred_time: '09:00',
    attendance_pattern: 'fortnightly' as const,
    fortnight_anchor: '2026-10-17',
    student_schedules: [
      { day_of_week: 'Saturday', start_time: '10:00:00', active: true },
      { day_of_week: 'Sunday', start_time: '09:00:00', active: true },
    ],
  }
  const rachel = {
    preferred_day: 'Friday',
    preferred_time: '17:00',
    attendance_pattern: 'fortnightly' as const,
    fortnight_anchor: '2026-10-09',
    student_schedules: [
      { day_of_week: 'Friday', start_time: '17:00:00', active: true },
      { day_of_week: 'Saturday', start_time: '09:00:00', active: true },
    ],
  }

  it('falls back to the single preferred day when there are no schedule rows', () => {
    expect(weeklySlots({ preferred_day: 'Tuesday', preferred_time: '16:00' })).toEqual([{ day: 'Tuesday', time: '16:00' }])
    expect(weeklySlots({ preferred_day: null })).toEqual([])
  })

  it('ignores inactive schedule rows', () => {
    const s = { preferred_day: 'Monday', preferred_time: '16:00', student_schedules: [{ day_of_week: 'Monday', start_time: '10:00', active: false }] }
    expect(weeklySlots(s)).toEqual([{ day: 'Monday', time: '16:00' }])
  })

  it('finds the right session time for a date', () => {
    expect(slotOnDate(nia, '2026-10-17')?.time).toBe('10:00:00')
    expect(slotOnDate(nia, '2026-10-18')?.time).toBe('09:00:00')
    expect(slotOnDate(nia, '2026-10-19')).toBeNull()
  })

  it('Nia is expected on both days of her on week and neither in her off week', () => {
    expect(isExpectedOnDate(nia, '2026-10-17')).toBe(true) // Sat
    expect(isExpectedOnDate(nia, '2026-10-18')).toBe(true) // Sun
    expect(isExpectedOnDate(nia, '2026-10-24')).toBe(false)
    expect(isExpectedOnDate(nia, '2026-10-25')).toBe(false)
    expect(isExpectedOnDate(nia, '2026-10-31')).toBe(true)
    expect(isExpectedOnDate(nia, '2026-11-01')).toBe(true)
  })

  it('Rachel is on this week (23/24 Oct) and off next (30/31 Oct)', () => {
    expect(isExpectedOnDate(rachel, '2026-10-09')).toBe(true)
    expect(isExpectedOnDate(rachel, '2026-10-10')).toBe(true)
    expect(isExpectedOnDate(rachel, '2026-10-16')).toBe(false)
    expect(isExpectedOnDate(rachel, '2026-10-23')).toBe(true)
    expect(isExpectedOnDate(rachel, '2026-10-24')).toBe(true)
    expect(isExpectedOnDate(rachel, '2026-10-30')).toBe(false)
  })

  it('describes sessions in week order', () => {
    expect(describeSlots(rachel, (t) => t.slice(0, 5))).toBe('Fri 17:00 · Sat 09:00')
  })
})

describe('Christmas and New Year closures on weekends', () => {
  it('closes the real days, not only the substitutes', () => {
    expect(closureName('2026-12-26')).toBe('Boxing Day') // a Saturday
    expect(closureName('2027-12-25')).toBe('Christmas Day') // a Saturday
    expect(closureName('2028-01-01')).toBe("New Year's Day") // a Saturday
    expect(isClosedDay('2026-12-27')).toBe(false)
  })
})
