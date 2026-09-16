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

export interface SessionTimeBucket {
  label: string
  count: number
}

export interface SessionTimeBreakdown {
  weekday: SessionTimeBucket[]
  weekend: SessionTimeBucket[]
}

const WEEKEND_DAYS = new Set(['Saturday', 'Sunday'])

/** Number of students scheduled at each session time, split into weekday
 *  vs weekend — computed entirely from actual student.preferred_day /
 *  preferred_time values, never hard-coded. Times within each bucket are
 *  sorted chronologically. */
export function sessionTimeBreakdown(
  students: { preferred_day: string | null; preferred_time: string | null }[],
): SessionTimeBreakdown {
  const weekdayCounts = new Map<string, number>()
  const weekendCounts = new Map<string, number>()
  for (const s of students) {
    if (!s.preferred_day || !s.preferred_time) continue
    const bucket = WEEKEND_DAYS.has(s.preferred_day) ? weekendCounts : weekdayCounts
    bucket.set(s.preferred_time, (bucket.get(s.preferred_time) ?? 0) + 1)
  }
  const toSorted = (m: Map<string, number>): SessionTimeBucket[] =>
    [...m.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([label, count]) => ({ label, count }))
  return { weekday: toSorted(weekdayCounts), weekend: toSorted(weekendCounts) }
}

export function countByStatus(rows: Pick<Attendance, 'status'>[]): Record<AttendanceStatus, number> {
  const out: Record<AttendanceStatus, number> = { 'Not Arrived': 0, Arrived: 0, Absent: 0, Completed: 0 }
  for (const r of rows) out[r.status]++
  return out
}

/** Groups attendance rows (most-recent-first is fine, any order in) into
 *  month buckets, e.g. "September 2026", each bucket sorted newest-first —
 *  used for the Student page's attendance history. */
export function groupAttendanceByMonth<T extends { date: string }>(rows: T[]): { month: string; rows: T[] }[] {
  const order: string[] = []
  const byMonth = new Map<string, T[]>()
  const sorted = [...rows].sort((a, b) => b.date.localeCompare(a.date))
  for (const r of sorted) {
    const [y, m] = r.date.split('-')
    const label = new Date(Number(y), Number(m) - 1, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
    if (!byMonth.has(label)) {
      byMonth.set(label, [])
      order.push(label)
    }
    byMonth.get(label)!.push(r)
  }
  return order.map((month) => ({ month, rows: byMonth.get(month)! }))
}
