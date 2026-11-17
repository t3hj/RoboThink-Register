import type { Attendance, AttendedSession } from '../types'
import { attendancePercentage, classifyAttendance, summariseAttendance } from './attendanceStats'

type Session = Pick<AttendedSession, 'id' | 'date' | 'session_number'> & Partial<Pick<AttendedSession, 'student_id'>>
type AttendanceUnit = Pick<Attendance, 'id' | 'date' | 'status' | 'session_type' | 'catch_up' | 'time_in' | 'time_out'> & {
  sessionNumber?: number
  student_id?: string
}

/** One student's attendance, counted by recorded sessions rather than lessons.
 * A daily attendance mark represents one visit when no session details exist.
 * Recorded sessions replace that visit, never add to it. Further explicitly
 * recorded sessions that day provide one make-up credit each.
 */
export function studentAttendance(attendance: Attendance[], sessions: Session[], today: string) {
  const byDate = new Map<string, Session[]>()
  const seen = new Set<string>()
  for (const session of sessions) {
    if (session.date > today || seen.has(session.id)) continue
    seen.add(session.id)
    byDate.set(session.date, [...(byDate.get(session.date) ?? []), session])
  }
  const daily = new Map(attendance.filter((row) => row.date <= today).map((row) => [row.date, row]))
  const units: AttendanceUnit[] = []
  for (const date of new Set([...daily.keys(), ...byDate.keys()])) {
    const mark = daily.get(date)
    const recorded = [...(byDate.get(date) ?? [])].sort((a, b) => a.session_number - b.session_number || a.id.localeCompare(b.id))
    // Explicit absence/unmarked decisions remain authoritative; old session
    // details must not silently reverse a later register correction.
    if (mark && (mark.status === 'Absent' || mark.status === 'Not Arrived' || recorded.length === 0)) {
      units.push({ ...mark })
      continue
    }
    recorded.forEach((session, index) => {
      const extra = index > 0 || mark?.session_type === 'catch_up' || mark?.session_type === 'special' || mark?.catch_up === true
      units.push({
        id: session.id,
        student_id: mark?.student_id ?? session.student_id ?? attendance[0]?.student_id,
        date,
        status: mark?.status ?? 'Completed',
        session_type: index > 0 ? 'catch_up' : mark?.session_type ?? 'regular',
        catch_up: extra,
        sessionNumber: session.session_number,
        time_in: index === 0 ? mark?.time_in ?? null : null,
        time_out: index === 0 ? mark?.time_out ?? null : null,
      })
    })
  }
  const summary = summariseAttendance(units)
  return {
    rows: classifyAttendance(units),
    sessionsAttended: summary.attended + summary.extra,
    catchUpsAttended: summary.extra,
    madeUp: summary.madeUp,
    outstandingAbsences: summary.missed,
    percentage: attendancePercentage(units),
  }
}
