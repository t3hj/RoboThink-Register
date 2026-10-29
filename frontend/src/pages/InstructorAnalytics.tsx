import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { PageHeader, StatCard, LoadingPanel, ErrorPanel, EmptyState, StatusBadge } from '../components/ui'
import { todayISO, addDays, formatShortDate } from '../lib/dates'
import { parseLevelName } from '../lib/curriculum'
import { attendancePercentage, attendanceFlag, FLAG_LABELS, summariseRange, isExpectedOnDate } from '../lib/attendanceStats'
import { AttendanceTrendChart, lastTwelveWeekStarts, weeklyAttendancePoints } from '../components/AnalyticsCharts'
import type { Attendance, Student, StudentProgress } from '../types'

export default function InstructorAnalytics() {
  const today = todayISO()
  const [students, setStudents] = useState<Student[]>([])
  const [progress, setProgress] = useState<StudentProgress[]>([])
  const [todayAttendance, setTodayAttendance] = useState<Attendance[]>([])
  const [weekAttendance, setWeekAttendance] = useState<Attendance[]>([])
  const [trendAttendance, setTrendAttendance] = useState<Attendance[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [selectedStudentId, setSelectedStudentId] = useState('')
  const [studentHistory, setStudentHistory] = useState<Attendance[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)

  const weekStart = addDays(today, -6)
  const weekStarts = useMemo(() => lastTwelveWeekStarts(today), [today])
  const trendStart = weekStarts[0]

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const [sRes, pRes, taRes, waRes, trendRes] = await Promise.all([
      supabase.from('students').select('*, student_schedules(day_of_week,start_time,active)').eq('active', true).order('full_name'),
      supabase.from('student_progress').select('*'),
      supabase.from('attendance').select('*').eq('date', today),
      supabase.from('attendance').select('*').gte('date', weekStart).lte('date', today),
      supabase.from('attendance').select('*').gte('date', trendStart).lte('date', today),
    ])
    if (sRes.error || pRes.error || taRes.error || waRes.error || trendRes.error) {
      setError(sRes.error?.message ?? pRes.error?.message ?? taRes.error?.message ?? waRes.error?.message ?? trendRes.error?.message ?? 'Unknown error')
      setLoading(false)
      return
    }
    setStudents((sRes.data ?? []) as Student[])
    setProgress((pRes.data ?? []) as StudentProgress[])
    setTodayAttendance((taRes.data ?? []) as Attendance[])
    setWeekAttendance((waRes.data ?? []) as Attendance[])
    setTrendAttendance((trendRes.data ?? []) as Attendance[])
    setLoading(false)
  }, [today, weekStart, trendStart])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!selectedStudentId) {
      setStudentHistory([])
      return
    }
    let cancelled = false
    setHistoryLoading(true)
    supabase
      .from('attendance')
      .select('*')
      .eq('student_id', selectedStudentId)
      .order('date', { ascending: false })
      .limit(30)
      .then(({ data, error }) => {
        if (cancelled) return
        if (!error) setStudentHistory((data ?? []) as Attendance[])
        setHistoryLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [selectedStudentId])

  const expectedToday = useMemo(() => students.filter((s) => isExpectedOnDate(s, today)), [students, today])
  const expectedIds = useMemo(() => new Set(expectedToday.map((s) => s.id)), [expectedToday])
  const extraToday = useMemo(() => todayAttendance.filter((a) => !expectedIds.has(a.student_id)), [todayAttendance, expectedIds])
  const attMapToday = useMemo(() => new Map(todayAttendance.map((a) => [a.student_id, a])), [todayAttendance])

  const todayStats = useMemo(() => {
    const attended = todayAttendance.filter((a) => a.status === 'Arrived' || a.status === 'Completed').length
    const absent = todayAttendance.filter((a) => a.status === 'Absent').length
    const notArrived = expectedToday.filter((s) => (attMapToday.get(s.id)?.status ?? 'Not Arrived') === 'Not Arrived').length
    const pct = attended + absent ? Math.round((attended / (attended + absent)) * 100) : null
    const catchUp = todayAttendance.filter((a) => a.session_type === 'catch_up').length
    const special = todayAttendance.filter((a) => a.session_type === 'special').length
    const newToday = students.filter((s) => s.date_joined === today).length
    return { attended, absent, notArrived, pct, catchUp, special, newToday, expected: expectedToday.length + extraToday.length }
  }, [todayAttendance, expectedToday, extraToday, attMapToday, students, today])

  const weekStats = useMemo(() => {
    let expected = 0
    for (let i = 0; i < 7; i++) {
      const d = addDays(weekStart, i)
      expected += students.filter((s) => isExpectedOnDate(s, d)).length
    }
    const { attended, missed } = summariseRange(trendAttendance, weekStart, today)
    const catchUp = weekAttendance.filter((a) => a.session_type === 'catch_up').length
    const pct = attended + missed ? Math.round((attended / (attended + missed)) * 100) : null
    return { expected, attended, missed, catchUp, pct }
  }, [weekAttendance, trendAttendance, students, weekStart, today])

  const trendPoints = useMemo(() => weeklyAttendancePoints(trendAttendance, weekStarts), [trendAttendance, weekStarts])
  const attendanceFollowups = useMemo(() => {
    const rowsByStudent = new Map<string, Attendance[]>()
    for (const row of trendAttendance) rowsByStudent.set(row.student_id, [...(rowsByStudent.get(row.student_id) ?? []), row])
    const priority = { several_recent_missed: 0, missed_recently: 1, no_attendance_recently: 2 }
    return students
      .map((student) => ({
        student,
        flag: attendanceFlag({ rows: rowsByStudent.get(student.id) ?? [], today, hasSchedule: Boolean(student.preferred_day), frequency: student.attendance_pattern }),
      }))
      .filter((item): item is { student: Student; flag: keyof typeof FLAG_LABELS } => item.flag != null)
      .sort((a, b) => priority[a.flag] - priority[b.flag] || a.student.full_name.localeCompare(b.student.full_name))
  }, [students, trendAttendance, today])

  const overview = useMemo(() => {
    const byLevel = new Map<string, number>()
    for (const s of students) {
      const prog = progress.find((p) => p.student_id === s.id)
      const programme = parseLevelName(prog?.level_name ?? s.levels?.name ?? 'Unknown').programme
      byLevel.set(programme, (byLevel.get(programme) ?? 0) + 1)
    }
    const bySub = new Map<number, number>()
    for (const s of students) if (s.subscription_id != null) bySub.set(s.subscription_id, (bySub.get(s.subscription_id) ?? 0) + 1)
    const newRecently = students.filter((s) => s.date_joined && s.date_joined >= addDays(today, -30)).length
    const currentlyAttending = todayAttendance.filter((a) => a.status === 'Arrived').length
    return { byLevel: [...byLevel.entries()], bySub, newRecently, currentlyAttending }
  }, [students, progress, today, todayAttendance])

  const selectedStudent = students.find((s) => s.id === selectedStudentId) ?? null
  const selectedPct = attendancePercentage(studentHistory)
  const selectedFlag = selectedStudent
    ? attendanceFlag({ rows: studentHistory, today, hasSchedule: Boolean(selectedStudent.preferred_day), frequency: selectedStudent.attendance_pattern })
    : null

  if (loading) return <LoadingPanel label="Loading analytics…" />
  if (error) return <ErrorPanel message={error} onRetry={() => void load()} />

  return (
    <div>
      <PageHeader title="Analytics" subtitle="Instructor view — today, this week, and individual students" accent="green" />

      <h2 className="text-lg font-semibold mb-3">Attendance and follow-up · Last 12 weeks</h2>
      <div className="grid lg:grid-cols-2 gap-6 mb-6">
        <AttendanceTrendChart points={trendPoints} />
        <section className="card p-4" aria-labelledby="attendance-followup-title">
          <div className="flex items-center justify-between gap-3 mb-3">
            <div>
              <h3 id="attendance-followup-title" className="font-semibold">Students to follow up</h3>
              <p className="text-xs text-slate-600 mt-1">Flags repeated recent absences and scheduled students without recent attendance.</p>
            </div>
            <span className="badge badge-assess">{attendanceFollowups.length}</span>
          </div>
          {attendanceFollowups.length === 0 ? (
            <p className="text-sm text-slate-600 py-5">No attendance follow-ups flagged right now.</p>
          ) : (
            <ul className="divide-y divide-slate-100 max-h-80 overflow-y-auto">
              {attendanceFollowups.slice(0, 12).map(({ student, flag }) => (
                <li key={student.id} className="py-2 flex items-center justify-between gap-3 text-sm">
                  <Link to={`/students/${student.id}`} className="font-medium hover:underline truncate">{student.full_name}</Link>
                  <span className="badge badge-assess shrink-0">{FLAG_LABELS[flag]}</span>
                </li>
              ))}
            </ul>
          )}
          {attendanceFollowups.length > 12 && <p className="text-xs text-slate-600 mt-2">Showing 12 of {attendanceFollowups.length}; use the student list to see the rest.</p>}
        </section>
      </div>

      <h2 className="text-lg font-semibold mb-3">Today</h2>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard value={todayStats.expected} label="Expected today" />
        <StatCard value={todayStats.attended} label="Attended" tone="good" />
        <StatCard value={todayStats.notArrived} label="Not arrived" />
        <StatCard value={todayStats.absent} label="Absent" tone={todayStats.absent > 0 ? 'bad' : undefined} />
        <StatCard value={todayStats.pct == null ? '—' : `${todayStats.pct}%`} label="Attendance %" />
        <StatCard value={todayStats.catchUp} label="Catch-up today" />
        <StatCard value={todayStats.special} label="Special sessions today" />
        <StatCard value={todayStats.newToday} label="New students today" />
      </div>

      <h2 className="text-lg font-semibold mb-3">This week ({formatShortDate(weekStart)} – {formatShortDate(today)})</h2>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard value={weekStats.expected} label="Expected sessions" />
        <StatCard value={weekStats.attended} label="Attended" tone="good" />
        <StatCard value={weekStats.missed} label="Missed" tone={weekStats.missed > 0 ? 'bad' : undefined} />
        <StatCard value={weekStats.pct == null ? '—' : `${weekStats.pct}%`} label="Attendance %" />
        <StatCard value={weekStats.catchUp} label="Catch-up sessions" />
      </div>

      <div className="grid md:grid-cols-2 gap-6 mb-6">
        <section className="card p-4">
          <h3 className="font-semibold mb-3">Student overview</h3>
          <dl className="text-sm space-y-1.5">
            <div className="flex justify-between"><dt className="text-slate-600">Total active students</dt><dd className="font-medium">{students.length}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-600">Currently attending (arrived)</dt><dd className="font-medium">{overview.currentlyAttending}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-600">New in last 30 days</dt><dd className="font-medium">{overview.newRecently}</dd></div>
          </dl>
          <div className="mt-3 pt-3 border-t border-slate-100">
            <div className="text-xs uppercase text-slate-600 mb-1.5">By programme</div>
            {overview.byLevel.map(([name, count]) => (
              <div key={name} className="flex justify-between text-sm py-0.5">
                <span>{name}</span><span className="font-medium">{count}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="card p-4">
          <h3 className="font-semibold mb-3">Look up a student</h3>
          <select
            className="w-full p-2 border border-slate-200 rounded-lg text-sm mb-3"
            value={selectedStudentId}
            onChange={(e) => setSelectedStudentId(e.target.value)}
            aria-label="Select a student"
          >
            <option value="">— Choose a student —</option>
            {students.map((s) => (
              <option key={s.id} value={s.id}>{s.full_name}</option>
            ))}
          </select>
          {historyLoading ? (
            <div className="text-sm text-slate-600">Loading…</div>
          ) : selectedStudent ? (
            <>
              <div className="flex items-center gap-3 mb-3">
                <div className="text-2xl font-bold">{selectedPct == null ? '—' : `${selectedPct}%`}</div>
                <div className="text-sm text-slate-600">attendance ({studentHistory.length} recent sessions)</div>
              </div>
              {selectedFlag && (
                <div className="badge badge-assess mb-3">{FLAG_LABELS[selectedFlag]}</div>
              )}
              <Link to={`/students/${selectedStudent.id}`} className="text-sm text-[color:var(--rt-primary)] hover:underline block mb-2">
                View full profile →
              </Link>
              <ul className="max-h-48 overflow-y-auto divide-y divide-slate-100 text-sm">
                {studentHistory.map((a) => (
                  <li key={a.id} className="py-1.5 flex items-center justify-between">
                    <span>{formatShortDate(a.date)}{a.session_type !== 'regular' && <span className="text-slate-600"> · {a.session_type === 'catch_up' ? 'catch-up' : 'special'}</span>}</span>
                    <StatusBadge status={a.status} />
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <EmptyState title="No student selected" hint="Pick a student above to see their attendance history." />
          )}
        </section>
      </div>
    </div>
  )
}
