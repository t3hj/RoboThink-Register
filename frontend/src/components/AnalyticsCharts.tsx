import type { Attendance, Student } from '../types'
import { classifyAttendance } from '../lib/attendanceStats'
import { addDays, formatShortDate, parseISODate } from '../lib/dates'

export interface WeeklyAttendancePoint {
  weekStart: string
  attended: number
  missed: number
  rate: number | null
}

export interface CentreAttendancePoint {
  id: string
  name: string
  attended: number
  missed: number
  rate: number | null
}

export interface StudentRetentionCohortPoint {
  weekStart: string
  active: number
  total: number
  rate: number
}

export function lastTwelveWeekStarts(today: string): string[] {
  const localDate = parseISODate(today)
  const mondayOffset = (localDate.getDay() + 6) % 7
  const currentWeekStart = addDays(today, -mondayOffset)
  return Array.from({ length: 12 }, (_, index) => addDays(currentWeekStart, (index - 11) * 7))
}

export function weeklyAttendancePoints(rows: Attendance[], weekStarts: string[]): WeeklyAttendancePoint[] {
  // Classify across every row first so an absence is still recognised as
  // made up when its catch-up session falls in the following week.
  const classified = classifyAttendance(rows)
  return weekStarts.map((weekStart) => {
    const end = addDays(weekStart, 6)
    const weekRows = classified.filter((row) => row.date >= weekStart && row.date <= end)
    const attended = weekRows.filter((row) => row.kind === 'attended').length
    const missed = weekRows.filter((row) => row.kind === 'missed').length
    return { weekStart, attended, missed, rate: attended + missed ? Math.round((attended / (attended + missed)) * 100) : null }
  })
}

export function studentRetentionCohorts(students: Student[], weekStarts: string[], today: string): StudentRetentionCohortPoint[] {
  return weekStarts.map((weekStart) => {
    const weekEnd = addDays(weekStart, 6)
    const cohort = students.filter((student) => student.date_joined != null && student.date_joined >= weekStart && student.date_joined <= weekEnd && student.date_joined <= today)
    const active = cohort.filter((student) => student.active).length
    return { weekStart, active, total: cohort.length, rate: cohort.length ? Math.round((active / cohort.length) * 100) : 0 }
  }).filter((cohort) => cohort.total > 0)
}

export function AttendanceTrendChart({ points, title = 'Attendance over the last 12 weeks' }: { points: WeeklyAttendancePoint[]; title?: string }) {
  const plotted = points.filter((point) => point.rate != null)
  const chartWidth = 720
  const chartHeight = 230
  const left = 42
  const right = 12
  const top = 18
  const bottom = 48
  const plotWidth = chartWidth - left - right
  const plotHeight = chartHeight - top - bottom
  const x = (index: number) => left + (points.length <= 1 ? plotWidth / 2 : (index / (points.length - 1)) * plotWidth)
  const y = (rate: number) => top + ((100 - rate) / 100) * plotHeight
  const line = points.map((point, index) => {
    if (point.rate == null) return ''
    const command = index === 0 || points[index - 1]?.rate == null ? 'M' : 'L'
    return `${command} ${x(index)} ${y(point.rate)}`
  }).filter(Boolean).join(' ')

  return (
    <section className="card p-4" aria-labelledby="attendance-trend-title">
      <div className="flex items-start justify-between gap-3 mb-2">
        <div>
          <h3 id="attendance-trend-title" className="font-semibold">{title}</h3>
          <p className="text-xs text-slate-600 mt-1">Attendance rate from sessions marked arrived, completed, or absent.</p>
        </div>
        <span className="inline-flex items-center gap-1.5 text-xs text-slate-600 whitespace-nowrap">
          <span className="w-2.5 h-2.5 rounded-full bg-[color:var(--rt-primary)]" aria-hidden="true" /> Attendance %
        </span>
      </div>
      {plotted.length === 0 ? (
        <p className="text-sm text-slate-600 py-8 text-center">No marked attendance in this period yet.</p>
      ) : (
        <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} className="w-full h-auto" role="img" aria-label={`${title}. ${plotted.map((point) => `${formatShortDate(point.weekStart)}: ${point.rate}%`).join('; ')}`}>
          {[0, 50, 100].map((rate) => (
            <g key={rate}>
              <line x1={left} x2={chartWidth - right} y1={y(rate)} y2={y(rate)} stroke="currentColor" className="text-slate-200" strokeDasharray={rate === 0 ? undefined : '3 5'} />
              <text x={left - 8} y={y(rate) + 4} textAnchor="end" className="fill-slate-400" fontSize="11">{rate}%</text>
            </g>
          ))}
          {line && <path d={line} fill="none" stroke="var(--rt-primary)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />}
          {points.map((point, index) => point.rate == null ? null : (
            <g key={point.weekStart}>
              <circle cx={x(index)} cy={y(point.rate)} r="5" fill="var(--rt-primary)" stroke="white" strokeWidth="2">
                <title>{`${formatShortDate(point.weekStart)}: ${point.rate}% (${point.attended} attended, ${point.missed} missed)`}</title>
              </circle>
            </g>
          ))}
          {points.map((point, index) => index % 2 === 0 || index === points.length - 1 ? (
            <text key={point.weekStart} x={x(index)} y={chartHeight - 18} textAnchor="middle" className="fill-slate-500" fontSize="10">{formatShortDate(point.weekStart)}</text>
          ) : null)}
        </svg>
      )}
      <p className="text-xs text-slate-600 mt-1">Weeks begin Monday. Point details include attended and missed counts.</p>
    </section>
  )
}

export function CentreAttendanceChart({ points }: { points: CentreAttendancePoint[] }) {
  const chartPoints = points.filter((point) => point.rate != null).sort((a, b) => (b.rate ?? 0) - (a.rate ?? 0))
  return (
    <section className="card p-4" aria-labelledby="centre-attendance-title">
      <div className="mb-3">
        <h3 id="centre-attendance-title" className="font-semibold">Attendance by centre · 12 weeks</h3>
        <p className="text-xs text-slate-600 mt-1">Centres are grouped by each student’s current centre assignment.</p>
      </div>
      {chartPoints.length === 0 ? (
        <p className="text-sm text-slate-600 py-8 text-center">No marked attendance for these centres in this period yet.</p>
      ) : (
        <div className="space-y-3" role="list" aria-label="Twelve-week attendance rate by centre">
          {chartPoints.map((point) => (
            <div key={point.id} role="listitem" className="grid grid-cols-[minmax(6rem,10rem)_1fr_auto] items-center gap-3 text-sm">
              <span className="truncate" title={point.name}>{point.name}</span>
              <div className="h-3 rounded-full bg-slate-100 overflow-hidden" role="img" aria-label={`${point.name}: ${point.rate}% attendance`}>
                <div className="h-full rounded-full bg-[color:var(--rt-primary)]" style={{ width: `${point.rate}%` }} />
              </div>
              <span className="tabular-nums text-right min-w-20"><strong>{point.rate}%</strong><span className="text-xs text-slate-600"> · {point.attended}/{point.attended + point.missed}</span></span>
            </div>
          ))}
        </div>
      )}
      <p className="text-xs text-slate-600 mt-3">Rate = attended ÷ sessions marked. Unmarked and not-arrived rows are excluded.</p>
    </section>
  )
}

export function StudentRetentionChart({ cohorts }: { cohorts: StudentRetentionCohortPoint[] }) {
  return (
    <section className="card p-4" aria-labelledby="student-retention-title">
      <div className="mb-3">
        <h3 id="student-retention-title" className="font-semibold">Student retention by join week · 12 weeks</h3>
        <p className="text-xs text-slate-600 mt-1">Share of each new-student cohort currently marked active.</p>
      </div>
      {cohorts.length === 0 ? (
        <p className="text-sm text-slate-600 py-8 text-center">No students joined in this period.</p>
      ) : (
        <div className="space-y-3" role="list" aria-label="Current active rate by student join week">
          {cohorts.map((cohort) => (
            <div key={cohort.weekStart} role="listitem" className="grid grid-cols-[4.5rem_minmax(4rem,1fr)_auto] items-center gap-3 text-sm">
              <span className="text-slate-600">{formatShortDate(cohort.weekStart)}</span>
              <div className="h-3 rounded-full bg-slate-100 overflow-hidden" role="img" aria-label={`${formatShortDate(cohort.weekStart)} cohort: ${cohort.rate}% currently active`}>
                <div className="h-full rounded-full bg-emerald-600" style={{ width: `${cohort.rate}%` }} />
              </div>
              <span className="tabular-nums text-right min-w-24"><strong>{cohort.rate}%</strong><span className="text-xs text-slate-600"> · {cohort.active}/{cohort.total} active</span></span>
            </div>
          ))}
        </div>
      )}
      <p className="text-xs text-slate-600 mt-3">Cohorts are students whose join date falls in that week. The app records current active status, not the date a student became inactive.</p>
    </section>
  )
}
