import { describe, expect, it } from 'vitest'
import { managementAnalytics, mondayOf, type ManagementData } from '../src/lib/managementAnalytics'
import { addDays } from '../src/lib/dates'
import { attendancePercentage, classifyAttendance } from '../src/lib/attendanceStats'
import { weeklyAttendancePoints } from '../src/components/AnalyticsCharts'
import type { Attendance, Student, TermTimeFollowup } from '../src/types'

const today = '2026-11-17'
const student = (id = 'a', extra: Partial<Student> = {}) =>
  ({
    id,
    full_name: `Student ${id}`,
    active: true,
    brand: 'robothink',
    centre_id: 'centre',
    preferred_day: 'Monday',
    date_joined: '2026-01-01',
    subscriptions: { name: 'Term Time' },
    ...extra,
  }) as Student
const mark = (
  date: string,
  status: Attendance['status'] = 'Completed',
  id = 'a',
  type: Attendance['session_type'] = 'regular',
) =>
  ({
    id: `${id}-${date}`,
    student_id: id,
    date,
    status,
    session_type: type,
    catch_up: type === 'catch_up',
  }) as Attendance
const marks = (count: number) => Array.from({ length: count }, (_, index) => mark(addDays('2026-10-01', index)))
const base = (extra: Partial<ManagementData> = {}): ManagementData => ({
  students: [student()],
  attendance: [],
  sessions: [],
  feedback: [],
  followups: [],
  ...extra,
})
const calc = (data: ManagementData) => managementAnalytics(data, '2026-11-16', '2026-11-22', today)

describe('session-based term-time follow-ups', () => {
  it('warns at 10 sessions, becomes due at 12 and ignores lesson numbers', () => {
    expect(calc(base({ attendance: marks(9) })).termTime).toHaveLength(0)
    expect(calc(base({ attendance: marks(10) })).termTime[0]).toMatchObject({ attended: 10, dueDate: null, block: 1 })
    expect(calc(base({ attendance: marks(11) })).due).toHaveLength(0)
    expect(calc(base({ attendance: marks(12) })).due[0]).toMatchObject({
      attended: 12,
      dueDate: '2026-10-12',
      block: 1,
    })
  })
  it('replaces the daily visit with recorded sessions rather than adding to it', () => {
    const data = base({
      attendance: marks(11),
      sessions: [{ id: 's1', student_id: 'a', date: '2026-10-11', session_number: 1 }],
    })
    expect(calc(data).due).toHaveLength(0)
    data.sessions.push({ id: 's2', student_id: 'a', date: '2026-10-11', session_number: 2 })
    expect(calc(data).due).toHaveLength(1)
    expect(calc(data).due[0].totalAttended).toBe(12)
  })
  it('counts attended catch-ups but not missed or unmarked sessions or future bookings', () => {
    const data = base({
      attendance: [
        ...marks(10),
        mark('2026-10-12', 'Absent'),
        mark('2026-10-13', 'Not Arrived'),
        mark('2026-10-14', 'Completed', 'a', 'catch_up'),
        mark('2026-12-01', 'Completed'),
      ],
    })
    expect(calc(data).due).toHaveLength(0)
    expect(calc(data).termTime[0].attended).toBe(11)
  })
  it('keeps previously renewed blocks and raises the next reminder at 24 sessions', () => {
    const record = { id: 'f', student_id: 'a', session_block: 1, status: 'extended' } as TermTimeFollowup
    const stats = calc(base({ attendance: marks(24), followups: [record] }))
    expect(stats.termTime).toHaveLength(2)
    expect(stats.due.map((entry) => entry.block)).toEqual([2])
  })
  it('tracks awaiting replies and overdue dates, excluding resolved records', () => {
    const record = {
      id: 'f',
      student_id: 'a',
      session_block: 1,
      status: 'contacted',
      next_follow_up_date: '2026-11-16',
    } as TermTimeFollowup
    const data = base({ attendance: marks(12), followups: [record] })
    expect(calc(data).awaitingReply).toHaveLength(1)
    expect(calc(data).overdue).toHaveLength(1)
    record.status = 'extended'
    expect(calc(data).overdue).toHaveLength(0)
  })
  it('keeps earlier lesson-based follow-ups for reference without treating them as session decisions', () => {
    const record = { id: 'old', student_id: 'a', session_block: null, status: 'contacted' } as TermTimeFollowup
    const stats = calc(base({ attendance: marks(12), followups: [record] }))
    expect(stats.legacyFollowups).toEqual([record])
    expect(stats.due).toHaveLength(1)
  })
  it('only creates reminders for active term-time students', () => {
    expect(calc(base({ students: [student('a', { active: false })], attendance: marks(12) })).due).toHaveLength(0)
    expect(
      calc(base({ students: [student('a', { subscriptions: { name: 'Elite' } })], attendance: marks(12) })).due,
    ).toHaveLength(0)
  })
})

describe('management attendance lists and totals', () => {
  it('treats future pre-marked catch-ups as bookings until their date arrives', () => {
    const stats = calc(base({ attendance: [mark('2026-11-20', 'Completed', 'a', 'catch_up')] }))
    expect(stats.catchUpsBooked).toBe(1)
    expect(stats.catchUpsAttended).toBe(0)
    expect(stats.attended).toHaveLength(0)
  })
  it('uses calendar weeks, including Sunday and year boundaries', () => {
    expect(mondayOf('2026-11-17')).toBe('2026-11-16')
    expect(mondayOf('2026-11-22')).toBe('2026-11-16')
    expect(mondayOf('2027-01-01')).toBe('2026-12-28')
  })
  it('distinguishes unique students from sessions and never counts daily marks twice', () => {
    const stats = calc(
      base({
        attendance: [mark('2026-11-16')],
        sessions: [1, 2].map((n) => ({ id: `s${n}`, student_id: 'a', date: '2026-11-16', session_number: n })),
      }),
    )
    expect(stats.uniqueAttended).toBe(1)
    expect(stats.attended).toHaveLength(2)
    expect(stats.catchUpsAttended).toBe(1)
  })
  it('distinguishes booked, attended and missed catch-ups without granting future credits', () => {
    const stats = calc(
      base({
        attendance: [
          mark('2026-11-16', 'Completed', 'a', 'catch_up'),
          mark('2026-11-17', 'Absent', 'a', 'catch_up'),
          mark('2026-11-20', 'Not Arrived', 'a', 'catch_up'),
        ],
      }),
    )
    expect(stats.catchUpsAttended).toBe(1)
    expect(stats.catchUpsBooked).toBe(1)
    expect(stats.catchUpsMissed).toBe(1)
    expect(stats.attended).toHaveLength(1)
  })
  it('keeps absence history with the paired make-up date, even across reporting periods', () => {
    const data = base({ attendance: [mark('2026-11-08', 'Absent'), mark('2026-11-16', 'Completed', 'a', 'catch_up')] })
    const stats = managementAnalytics(data, '2026-11-02', '2026-11-08', today)
    expect(stats.missed).toHaveLength(1)
    expect(stats.madeUp[0].makeUpDate).toBe('2026-11-16')
    expect(stats.outstanding).toHaveLength(0)
    expect(stats.percentage).toBe(100)
  })
  it('never pairs different students, including chart calculations', () => {
    const attendance = [mark('2026-11-16', 'Absent', 'a'), mark('2026-11-17', 'Completed', 'b', 'catch_up')]
    expect(classifyAttendance(attendance)[0].kind).toBe('missed')
    expect(attendancePercentage(attendance)).toBe(0)
    expect(weeklyAttendancePoints(attendance, ['2026-11-16'])[0].rate).toBe(0)
    expect(calc(base({ students: [student(), student('b')], attendance })).outstanding).toHaveLength(1)
  })
  it('does not count a missed catch-up as another owed regular session', () => {
    const stats = calc(
      base({ attendance: [mark('2026-11-16', 'Absent'), mark('2026-11-17', 'Absent', 'a', 'catch_up')] }),
    )
    expect(stats.outstanding).toHaveLength(1)
    expect(stats.catchUpsMissed).toBe(1)
  })
  it('keeps missing marks separate from absences and ignores today and centre closure dates', () => {
    const data = base({ students: [student(), student('b')], attendance: [mark('2026-11-16', 'Completed', 'b')] })
    const stats = calc(data)
    expect(stats.unmarked.map((row) => row.student.id)).toEqual(['a'])
    expect(stats.missed).toHaveLength(0)
    expect(managementAnalytics(data, '2026-12-28', '2026-12-28', '2026-12-29').unmarked).toHaveLength(0)
  })
  it('does not flag a newly joined student as long absent and respects fortnightly gaps', () => {
    expect(calc(base({ students: [student('a', { date_joined: '2026-11-16' })] })).concerns).toHaveLength(0)
    const data = base({
      students: [student('a', { attendance_pattern: 'fortnightly' })],
      attendance: [mark('2026-10-25')],
    })
    expect(calc(data).concerns).toHaveLength(0)
  })
})
