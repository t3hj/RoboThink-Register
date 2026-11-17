import { describe, expect, it } from 'vitest'
import { studentAttendance } from '../src/lib/studentAttendance'
import type { Attendance } from '../src/types'

const today = '2026-11-17'
const mark = (date: string, status: Attendance['status'] = 'Completed', type: Attendance['session_type'] = 'regular'): Attendance => ({
  id: `attendance-${date}`, student_id: 'student', date, status, session_type: type,
  catch_up: type === 'catch_up', time_in: null, time_out: null, scheduled_day: null,
  actual_day: null, instructor_id: null, created_at: `${date}T10:00:00Z`,
})
const session = (date: string, number = 1) => ({ id: `${date}-${number}`, date, session_number: number })

describe('student attendance uses explicit session records, independently of lessons', () => {
  it('counts a daily attendance mark and its recorded session only once', () => {
    const stats = studentAttendance([mark('2026-11-01')], [session('2026-11-01')], today)
    expect(stats.sessionsAttended).toBe(1)
    expect(stats.catchUpsAttended).toBe(0)
  })

  it('counts one attended visit without session details for historical registers', () => {
    expect(studentAttendance([mark('2026-11-01')], [], today).sessionsAttended).toBe(1)
  })

  it('counts two explicitly recorded sessions and lets the extra cover an absence', () => {
    const stats = studentAttendance([mark('2026-11-01', 'Absent'), mark('2026-11-08')], [session('2026-11-08'), session('2026-11-08', 2)], today)
    expect(stats).toMatchObject({ sessionsAttended: 2, catchUpsAttended: 1, madeUp: 1, outstandingAbsences: 0, percentage: 100 })
    expect(stats.rows.find((row) => row.date === '2026-11-01')?.kind).toBe('made_up')
  })

  it('one extra session covers only one absence', () => {
    const stats = studentAttendance([mark('2026-10-25', 'Absent'), mark('2026-11-01', 'Absent'), mark('2026-11-08')], [session('2026-11-08'), session('2026-11-08', 2)], today)
    expect(stats).toMatchObject({ sessionsAttended: 2, madeUp: 1, outstandingAbsences: 1, percentage: 67 })
  })

  it('a catch-up day with two recorded sessions can cover two absences', () => {
    const stats = studentAttendance([mark('2026-10-25', 'Absent'), mark('2026-11-01', 'Absent'), mark('2026-11-08', 'Completed', 'catch_up')], [session('2026-11-08'), session('2026-11-08', 2)], today)
    expect(stats).toMatchObject({ sessionsAttended: 2, catchUpsAttended: 2, madeUp: 2, outstandingAbsences: 0, percentage: 100 })
  })

  it('does not infer missing sessions from gaps in session numbers or duplicated records', () => {
    const stats = studentAttendance([mark('2026-11-08')], [session('2026-11-08', 3), session('2026-11-08', 3)], today)
    expect(stats.sessionsAttended).toBe(1)
    expect(stats.catchUpsAttended).toBe(0)
  })

  it('counts unfinished, assessment and project sessions without looking at lesson outcomes', () => {
    const sessions = [
      { ...session('2026-11-01'), outcome: 'not_finished', actual_lesson_id: 'lesson' },
      { ...session('2026-11-08'), assessment_records: [{ id: 'assessment' }] },
      { ...session('2026-11-15'), project_id: 'project' },
    ]
    expect(studentAttendance([], sessions, today).sessionsAttended).toBe(3)
  })

  it('preserves explicit absence and unmarked decisions despite stale session details', () => {
    const stats = studentAttendance([mark('2026-11-01', 'Absent'), mark('2026-11-08', 'Not Arrived')], [session('2026-11-01'), session('2026-11-08')], today)
    expect(stats).toMatchObject({ sessionsAttended: 0, madeUp: 0, outstandingAbsences: 1, percentage: 0 })
  })

  it('excludes future attendance and sessions so planned catch-ups cannot cancel an absence', () => {
    const stats = studentAttendance([mark('2026-11-01', 'Absent'), mark('2026-11-22', 'Completed', 'catch_up')], [session('2026-11-22')], today)
    expect(stats).toMatchObject({ sessionsAttended: 0, madeUp: 0, outstandingAbsences: 1, percentage: 0 })
  })

  it('supports legacy catch_up flags', () => {
    const catchUp = { ...mark('2026-11-08'), catch_up: true }
    expect(studentAttendance([mark('2026-11-01', 'Absent'), catchUp], [session('2026-11-08')], today)).toMatchObject({ catchUpsAttended: 1, madeUp: 1, percentage: 100 })
  })

  it('has no attendance rate for an empty or unmarked record', () => {
    expect(studentAttendance([], [], today).percentage).toBeNull()
    expect(studentAttendance([mark('2026-11-01', 'Not Arrived')], [], today).percentage).toBeNull()
  })
})
