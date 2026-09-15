import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { PageHeader, StatCard, LoadingPanel, ErrorPanel, EmptyState, StatusBadge } from '../components/ui'
import { todayISO, dayName, addDays, formatShortDate } from '../lib/dates'
import { parseLevelName } from '../lib/curriculum'
import { attendancePercentage, attendanceFlag, FLAG_LABELS } from '../lib/attendanceStats'
import type { Attendance, Student, StudentProgress } from '../types'

export default function InstructorAnalytics() {
  const today = todayISO()
  const [students, setStudents] = useState<Student[]>([])
  const [progress, setProgress] = useState<StudentProgress[]>([])
  const [todayAttendance, setTodayAttendance] = useState<Attendance[]>([])
  const [weekAttendance, setWeekAttendance] = useState<Attendance[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [selectedStudentId, setSelectedStudentId] = useState('')
  const [studentHistory, setStudentHistory] = useState<Attendance[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)

  const weekStart = addDays(today, -6)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const [sRes, pRes, taRes, waRes] = await Promise.all([
      supabase.from('students').select('*').eq('active', true).order('full_name'),
      supabase.from('student_progress').select('*'),
      supabase.from('attendance').select('*').eq('date', today),
      supabase.from('attendance').select('*').gte('date', weekStart).lte('date', today),
    ])
    if (sRes.error || pRes.error || taRes.error || waRes.error) {
      setError(sRes.error?.message ?? pRes.error?.message ?? taRes.error?.message ?? waRes.error?.message ?? 'Unknown error')
      setLoading(false)
      return
    }
    setStudents((sRes.data ?? []) as Student[])
    setProgress((pRes.data ?? []) as StudentProgress[])
    setTodayAttendance((taRes.data ?? []) as Attendance[])
    setWeekAttendance((waRes.data ?? []) as Attendance[])
    setLoading(false)
  }, [today, weekStart])

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

  const dow = dayName(today)
  const expectedToday = useMemo(() => students.filter((s) => s.preferred_day === dow), [students, dow])
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
      const d = dayName(addDays(weekStart, i))
      expected += students.filter((s) => s.preferred_day === d).length
    }
    const attended = weekAttendance.filter((a) => a.status === 'Arrived' || a.status === 'Completed').length
    const missed = weekAttendance.filter((a) => a.status === 'Absent').length
    const catchUp = weekAttendance.filter((a) => a.session_type === 'catch_up').length
    const pct = attendancePercentage(weekAttendance)
    return { expected, attended, missed, catchUp, pct }
  }, [weekAttendance, students, weekStart])

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
    ? attendanceFlag({ rows: studentHistory, today, hasSchedule: Boolean(selectedStudent.preferred_day) })
    : null

  if (loading) return <LoadingPanel label="Loading analytics…" />
  if (error) return <ErrorPanel message={error} onRetry={() => void load()} />

  return (
    <div>
      <PageHeader title="Analytics" subtitle="Instructor view — today, this week, and individual students" accent="green" />

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
            <div className="flex justify-between"><dt className="text-slate-500">Total active students</dt><dd className="font-medium">{students.length}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-500">Currently attending (arrived)</dt><dd className="font-medium">{overview.currentlyAttending}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-500">New in last 30 days</dt><dd className="font-medium">{overview.newRecently}</dd></div>
          </dl>
          <div className="mt-3 pt-3 border-t border-slate-100">
            <div className="text-xs uppercase text-slate-400 mb-1.5">By programme</div>
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
            <div className="text-sm text-slate-400">Loading…</div>
          ) : selectedStudent ? (
            <>
              <div className="flex items-center gap-3 mb-3">
                <div className="text-2xl font-bold">{selectedPct == null ? '—' : `${selectedPct}%`}</div>
                <div className="text-sm text-slate-500">attendance ({studentHistory.length} recent sessions)</div>
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
                    <span>{formatShortDate(a.date)}{a.session_type !== 'regular' && <span className="text-slate-400"> · {a.session_type === 'catch_up' ? 'catch-up' : 'special'}</span>}</span>
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
