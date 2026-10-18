import type { Attendance, AttendanceStatus, Student } from '../types'
import { addDays, dayName, parseISODate } from './dates'

type AttendanceLike = Pick<Attendance, 'status'> & Partial<Pick<Attendance, 'date' | 'session_type' | 'catch_up'>>

/** How a single attendance row counts towards a student's attendance record.
 *  - attended: a regular session the student came to
 *  - missed:   an absence nobody has made up
 *  - made_up:  an absence covered by a catch-up/special session shortly
 *              before or after it (not counted against the student)
 *  - extra:    a catch-up/special session that attended — it either made up
 *              an absence (above) or is a bonus session; never inflates the %
 *  - pending:  'Not Arrived' — the register hasn't been marked yet */
export type AttendanceKind = 'attended' | 'missed' | 'made_up' | 'extra' | 'pending'

/** An absence can be made up by a catch-up/special session up to this many
 *  days before it (e.g. a fortnightly student who doubles up the week before)
 *  or after it. */
export const MAKE_UP_DAYS_BEFORE = 7
export const MAKE_UP_DAYS_AFTER = 21

const isExtraSession = (r: AttendanceLike) => r.session_type === 'catch_up' || r.session_type === 'special' || r.catch_up === true
const didAttend = (status: AttendanceStatus) => status === 'Arrived' || status === 'Completed'

function daysBetween(a: string, b: string): number {
  return Math.round((parseISODate(b).getTime() - parseISODate(a).getTime()) / 86_400_000)
}

/** Classifies every row, pairing each absence one-to-one with the nearest
 *  unused catch-up/special session in the make-up window. Rows without a
 *  date or session_type are treated as ordinary regular sessions, so callers
 *  that only have a status still get the plain attended/(attended+absent)
 *  result. Returns new objects in the same order as the input. */
export function classifyAttendance<T extends AttendanceLike>(rows: T[]): (T & { kind: AttendanceKind })[] {
  const kinds: AttendanceKind[] = rows.map((r) => {
    if (r.status === 'Not Arrived') return 'pending'
    if (r.status === 'Absent') return 'missed'
    return isExtraSession(r) ? 'extra' : 'attended'
  })

  const absences = rows
    .map((r, i) => ({ r, i }))
    .filter(({ i }) => kinds[i] === 'missed' && rows[i].date)
    .sort((a, b) => a.r.date!.localeCompare(b.r.date!))
  const used = new Set<number>()
  for (const { r: absence, i } of absences) {
    let best = -1
    let bestGap = Infinity
    rows.forEach((candidate, j) => {
      if (used.has(j) || kinds[j] !== 'extra' || !candidate.date || !didAttend(candidate.status)) return
      const gap = daysBetween(absence.date!, candidate.date)
      if (gap < -MAKE_UP_DAYS_BEFORE || gap > MAKE_UP_DAYS_AFTER) return
      // Prefer a session after the absence, then the closest one.
      const score = gap >= 0 ? gap : Math.abs(gap) + 1000
      if (score < bestGap) {
        bestGap = score
        best = j
      }
    })
    if (best >= 0) {
      used.add(best)
      kinds[i] = 'made_up'
    }
  }
  return rows.map((r, i) => ({ ...r, kind: kinds[i] }))
}

export interface AttendanceSummary {
  attended: number
  missed: number
  madeUp: number
  extra: number
}

export function summariseAttendance(rows: AttendanceLike[]): AttendanceSummary {
  const out: AttendanceSummary = { attended: 0, missed: 0, madeUp: 0, extra: 0 }
  for (const { kind } of classifyAttendance(rows)) {
    if (kind === 'attended') out.attended++
    else if (kind === 'missed') out.missed++
    else if (kind === 'made_up') out.madeUp++
    else if (kind === 'extra') out.extra++
  }
  return out
}

/** Expected-vs-actual attendance %, counting only sessions where the
 *  student was actually marked (attended or absent). 'Not Arrived' rows for
 *  a date that hasn't happened yet aren't a miss; an absence that was made
 *  up with a catch-up session isn't a miss either, and catch-up sessions
 *  themselves never push the percentage up. */
export function attendancePercentage(rows: AttendanceLike[]): number | null {
  const { attended, missed } = summariseAttendance(rows)
  const relevant = attended + missed
  return relevant ? Math.round((attended / relevant) * 100) : null
}

export type AttendanceFlag = 'missed_recently' | 'several_recent_missed' | 'no_attendance_recently' | null

export interface FlagInput {
  /** Most-recent-first attendance rows for one student. */
  rows: (Pick<Attendance, 'status' | 'date'> & Partial<Pick<Attendance, 'session_type' | 'catch_up'>>)[]
  today: string
  /** Only flag "no attendance recently" for students who are actually
   *  expected somewhere (have a normal day) — otherwise silence is normal. */
  hasSchedule: boolean
  /** How many days of silence counts as concerning. Defaults to ~3 weeks for
   *  weekly students and ~5 weeks for fortnightly ones. */
  quietDays?: number
  frequency?: AttendancePattern | null
}

/** A single, sensible flag per student — never labels someone as having
 *  "dropped out" from one missed session. Priority: several recent misses
 *  > single recent miss > long silence > nothing. */
export function attendanceFlag({ rows, today, hasSchedule, frequency, quietDays }: FlagInput): AttendanceFlag {
  const quiet = quietDays ?? (frequency === 'fortnightly' ? 35 : 21)
  // An absence that has been made up is not a miss.
  const sorted = classifyAttendance(rows)
    .map((r) => (r.kind === 'made_up' ? { ...r, status: 'Not Arrived' as const } : r))
    .sort((a, b) => b.date.localeCompare(a.date))
  const recent3 = sorted.slice(0, 3)
  const recentAbsences = recent3.filter((r) => r.status === 'Absent').length

  if (recentAbsences >= 2) return 'several_recent_missed'
  if (sorted[0]?.status === 'Absent') return 'missed_recently'

  if (hasSchedule) {
    const daysSince = sorted.length
      ? Math.floor((Date.parse(today) - Date.parse(sorted[0].date)) / 86_400_000)
      : Infinity
    if (daysSince >= quiet) return 'no_attendance_recently'
  }
  return null
}

export const FLAG_LABELS: Record<Exclude<AttendanceFlag, null>, string> = {
  missed_recently: 'Missed recently',
  several_recent_missed: 'Several recent missed sessions',
  no_attendance_recently: 'No attendance recently',
}

export type AttendancePattern = 'weekly' | 'fortnightly'

/** Whole weeks between the Monday of two dates, so "same week" is 0 whatever
 *  day of the week each falls on. */
function weeksApart(a: string, b: string): number {
  const monday = (iso: string) => {
    const d = parseISODate(iso)
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
    return d.getTime()
  }
  return Math.round((monday(b) - monday(a)) / (7 * 86_400_000))
}

type ScheduleFields = Pick<Student, 'preferred_day'> & Partial<Pick<Student, 'attendance_pattern' | 'fortnight_anchor'>>

/** Whether a student is expected on a specific date. Weekly students are
 *  expected on their preferred day every week. Fortnightly students are
 *  expected on their preferred day only in their "on" weeks (every second
 *  week counting from `fortnight_anchor`). A fortnightly student with no
 *  anchor yet is treated as expected every week, so nobody silently drops
 *  off the register while the anchor is being set. */
export function isExpectedOnDate(student: ScheduleFields, date: string): boolean {
  if (!student.preferred_day || student.preferred_day !== dayName(date)) return false
  if (student.attendance_pattern !== 'fortnightly' || !student.fortnight_anchor) return true
  return Math.abs(weeksApart(student.fortnight_anchor, date)) % 2 === 0
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

export interface UnmarkedSession {
  date: string
  student: Student
}

/** Sessions that were expected between `from` and `to` (inclusive) but have
 *  no attendance row at all — i.e. the register was never marked for that
 *  student. A date only counts when the register was in use at the student's
 *  centre that day (at least one other student has a row), so closures and
 *  school holidays don't show up as forgotten registers. */
export function findUnmarkedSessions(
  students: Student[],
  attendance: Pick<Attendance, 'student_id' | 'date'>[],
  from: string,
  to: string,
): UnmarkedSession[] {
  const centreOf = new Map(students.map((s) => [s.id, s.centre_id ?? '']))
  const marked = new Set(attendance.map((a) => `${a.student_id}|${a.date}`))
  const registerRan = new Set(attendance.map((a) => `${centreOf.get(a.student_id) ?? ''}|${a.date}`))
  const out: UnmarkedSession[] = []
  for (let d = from; d <= to; d = addDays(d, 1)) {
    for (const student of students) {
      if (!student.active || !isExpectedOnDate(student, d)) continue
      if (student.date_joined && student.date_joined > d) continue
      if (marked.has(`${student.id}|${d}`)) continue
      if (!registerRan.has(`${student.centre_id ?? ''}|${d}`)) continue
      out.push({ date: d, student })
    }
  }
  return out.sort((a, b) => b.date.localeCompare(a.date) || a.student.full_name.localeCompare(b.student.full_name))
}
