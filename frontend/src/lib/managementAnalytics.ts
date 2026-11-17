import type { Attendance, AttendedSession, FeedbackSheet, Student, TermTimeFollowup } from '../types'
import { addDays, parseISODate } from './dates'
import { attendanceFlag, findUnmarkedSessions, isExpectedOnDate, weeklySlots } from './attendanceStats'
import { studentAttendance } from './studentAttendance'

export const TERM_TIME_BLOCK_SIZE = 12
type Session = Pick<AttendedSession, 'id' | 'student_id' | 'date' | 'session_number'>
export type ManagementAttendanceRow = ReturnType<typeof studentAttendance>['rows'][number] & { student: Student }
export interface TermTimeEntry {
  student: Student
  block: number
  attended: number
  totalAttended: number
  dueDate: string | null
  record: TermTimeFollowup | null
}
export interface ManagementData {
  students: Student[]
  attendance: Attendance[]
  sessions: Session[]
  followups: TermTimeFollowup[]
  feedback: FeedbackSheet[]
}

export function mondayOf(date: string): string {
  return addDays(date, -((parseISODate(date).getDay() + 6) % 7))
}

export function managementAnalytics(data: ManagementData, from: string, to: string, today: string) {
  const { students, attendance, sessions, followups, feedback } = data
  const attendanceByStudent = new Map<string, Attendance[]>()
  const sessionsByStudent = new Map<string, Session[]>()
  for (const row of attendance)
    attendanceByStudent.set(row.student_id, [...(attendanceByStudent.get(row.student_id) ?? []), row])
  for (const row of sessions)
    sessionsByStudent.set(row.student_id, [...(sessionsByStudent.get(row.student_id) ?? []), row])
  const rows: ManagementAttendanceRow[] = []
  const termTime: TermTimeEntry[] = []
  const concerns: { student: Student; label: string; lastAttended: string | null }[] = []
  for (const student of students) {
    const stats = studentAttendance(
      attendanceByStudent.get(student.id) ?? [],
      sessionsByStudent.get(student.id) ?? [],
      today,
    )
    const history = stats.rows.map((row) => ({ ...row, student }))
    rows.push(...history)
    if (!student.active) continue
    const visits = history
      .filter((row) => row.kind === 'attended' || row.kind === 'extra')
      .sort(
        (a, b) =>
          a.date.localeCompare(b.date) || (a.sessionNumber ?? 1) - (b.sessionNumber ?? 1) || a.id.localeCompare(b.id),
      )
    const lastAttended = visits.at(-1)?.date ?? null
    const outstanding = history.filter((row) => row.kind === 'missed').sort((a, b) => b.date.localeCompare(a.date))
    const quietDays = student.attendance_pattern === 'fortnightly' ? 35 : 21
    const quietSince = lastAttended ?? student.date_joined
    if (weeklySlots(student).length && quietSince && addDays(quietSince, quietDays) <= today) {
      concerns.push({ student, label: 'No attendance recently', lastAttended })
    } else {
      const flag = attendanceFlag({ rows: history, today, hasSchedule: false })
      if (flag === 'several_recent_missed')
        concerns.push({ student, label: 'Several recent missed sessions', lastAttended })
      else if (outstanding[0] && outstanding[0].date >= addDays(today, -14))
        concerns.push({ student, label: 'Outstanding absence', lastAttended })
    }
    if (student.subscriptions?.name !== 'Term Time') continue
    const total = visits.length
    const completedBlocks = Math.floor(total / TERM_TIME_BLOCK_SIZE)
    for (let block = 1; block <= completedBlocks; block++) {
      termTime.push({
        student,
        block,
        attended: TERM_TIME_BLOCK_SIZE,
        totalAttended: total,
        dueDate: visits[block * TERM_TIME_BLOCK_SIZE - 1].date,
        record: followups.find((row) => row.student_id === student.id && row.session_block === block) ?? null,
      })
    }
    const inNextBlock = total % TERM_TIME_BLOCK_SIZE
    if (inNextBlock >= 10)
      termTime.push({
        student,
        block: completedBlocks + 1,
        attended: inNextBlock,
        totalAttended: total,
        dueDate: null,
        record: null,
      })
  }
  const studentById = new Map(students.map((student) => [student.id, student]))
  const scoped = rows.filter((row) => row.date >= from && row.date <= to)
  const attended = scoped.filter((row) => row.kind === 'attended' || row.kind === 'extra')
  const missed = scoped.filter((row) => row.status === 'Absent')
  const outstanding = missed.filter((row) => row.kind === 'missed')
  const madeUp = missed.filter((row) => row.kind === 'made_up')
  const catchUps: ManagementAttendanceRow[] = scoped.filter(
    (row) =>
      row.kind === 'extra' ||
      (row.status !== 'Arrived' &&
        row.status !== 'Completed' &&
        (row.catch_up || row.session_type === 'catch_up' || row.session_type === 'special')),
  )
  // Future bookings are displayed but cannot provide make-up credit.
  for (const mark of attendance) {
    if (
      mark.date <= today ||
      mark.date < from ||
      mark.date > to ||
      !(mark.catch_up || mark.session_type === 'catch_up' || mark.session_type === 'special')
    )
      continue
    const student = studentById.get(mark.student_id)
    if (student) catchUps.push({ ...mark, status: 'Not Arrived', kind: 'pending', student })
  }
  const unmarked = findUnmarkedSessions(students, attendance, from, to < today ? to : addDays(today, -1)).map(
    ({ student, date }) => ({ student, date, reason: 'Attendance not marked' }),
  )
  for (const row of scoped) {
    if (row.date < today && row.status === 'Not Arrived')
      unmarked.push({ student: row.student, date: row.date, reason: 'Attendance not marked' })
  }
  let expected = 0
  let stillDue = 0
  for (let date = from; date <= to; date = addDays(date, 1)) {
    for (const student of students) {
      if (!student.active || (student.date_joined && student.date_joined > date) || !isExpectedOnDate(student, date))
        continue
      if (date <= today) expected++
      else stillDue++
    }
  }
  const regularAttended = scoped.filter((row) => row.kind === 'attended').length
  const fulfilled = regularAttended + madeUp.length
  const denominator = fulfilled + outstanding.length
  const due = termTime.filter((entry) => entry.dueDate && (!entry.record || entry.record.status === 'needs_follow_up'))
  const awaitingReply = termTime.filter((entry) => entry.record?.status === 'contacted')
  const overdue = termTime.filter(
    (entry) =>
      entry.record?.next_follow_up_date &&
      entry.record.next_follow_up_date < today &&
      !['extended', 'not_continuing'].includes(entry.record.status),
  )
  const feedbackOutstanding = feedback
    .filter((row) => row.status !== 'given' && studentById.has(row.student_id))
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
  const sortRows = (a: ManagementAttendanceRow, b: ManagementAttendanceRow) =>
    b.date.localeCompare(a.date) ||
    a.student.full_name.localeCompare(b.student.full_name) ||
    (a.sessionNumber ?? 1) - (b.sessionNumber ?? 1)
  return {
    attended: attended.sort(sortRows),
    uniqueAttended: new Set(attended.map((row) => row.student.id)).size,
    missed: missed.sort(sortRows),
    outstanding,
    madeUp,
    catchUps: catchUps.sort(sortRows),
    unmarked,
    expected,
    stillDue,
    catchUpsAttended: catchUps.filter((row) => row.kind === 'extra').length,
    catchUpsBooked: catchUps.filter((row) => row.status === 'Not Arrived' && row.date >= today).length,
    catchUpsMissed: catchUps.filter((row) => row.status === 'Absent').length,
    percentage: denominator ? Math.round((fulfilled / denominator) * 100) : null,
    rows,
    concerns,
    termTime,
    due,
    awaitingReply,
    overdue,
    feedbackOutstanding,
    legacyFollowups: followups.filter((row) => !row.session_block && studentById.has(row.student_id)),
  }
}
