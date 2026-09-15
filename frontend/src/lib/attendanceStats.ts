import type { Attendance, AttendanceStatus } from '../types'

/** Expected-vs-actual attendance %, counting only sessions where the
 *  student was actually marked in some way (Arrived/Completed/Absent) —
 *  'Not Arrived' rows for a date that hasn't happened yet aren't counted
 *  as a miss. */
export function attendancePercentage(rows: Pick<Attendance, 'status'>[]): number | null {
  const attended = rows.filter((r) => r.status === 'Arrived' || r.status === 'Completed').length
  const missed = rows.filter((r) => r.status === 'Absent').length
  const relevant = attended + missed
  return relevant ? Math.round((attended / relevant) * 100) : null
}

export type AttendanceFlag = 'missed_recently' | 'several_recent_missed' | 'no_attendance_recently' | null

export interface FlagInput {
  /** Most-recent-first attendance rows for one student. */
  rows: Pick<Attendance, 'status' | 'date'>[]
  today: string
  /** Only flag "no attendance recently" for students who are actually
   *  expected somewhere (have a normal day) — otherwise silence is normal. */
  hasSchedule: boolean
  /** How many days of silence counts as concerning. Default ~3 weeks. */
  quietDays?: number
}

/** A single, sensible flag per student — never labels someone as having
 *  "dropped out" from one missed session. Priority: several recent misses
 *  > single recent miss > long silence > nothing. */
export function attendanceFlag({ rows, today, hasSchedule, quietDays = 21 }: FlagInput): AttendanceFlag {
  const sorted = [...rows].sort((a, b) => b.date.localeCompare(a.date))
  const recent3 = sorted.slice(0, 3)
  const recentAbsences = recent3.filter((r) => r.status === 'Absent').length

  if (recentAbsences >= 2) return 'several_recent_missed'
  if (sorted[0]?.status === 'Absent') return 'missed_recently'

  if (hasSchedule) {
    const daysSince = sorted.length
      ? Math.floor((Date.parse(today) - Date.parse(sorted[0].date)) / 86_400_000)
      : Infinity
    if (daysSince >= quietDays) return 'no_attendance_recently'
  }
  return null
}

export const FLAG_LABELS: Record<Exclude<AttendanceFlag, null>, string> = {
  missed_recently: 'Missed recently',
  several_recent_missed: 'Several recent missed sessions',
  no_attendance_recently: 'No attendance recently',
}

/** Expected attendance for a given date, from preferred_day only — never
 *  from attendance history, and never marks a student as "missed" on a day
 *  they weren't actually expected. */
export function isExpectedOn(preferredDay: string | null, dayOfWeek: string): boolean {
  return preferredDay === dayOfWeek
}

export function countByStatus(rows: Pick<Attendance, 'status'>[]): Record<AttendanceStatus, number> {
  const out: Record<AttendanceStatus, number> = { 'Not Arrived': 0, Arrived: 0, Absent: 0, Completed: 0 }
  for (const r of rows) out[r.status]++
  return out
}
