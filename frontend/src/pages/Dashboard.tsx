import { useEffect, useState, useCallback, useRef } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../lib/auth'
import { useCentres } from '../lib/centres'
import { useBrand } from '../lib/brand'
import { PageHeader, StatCard, LoadingPanel, ErrorPanel, EmptyState, StatusBadge } from '../components/ui'
import CollapsiblePanel from '../components/CollapsiblePanel'
import { attendanceState } from '../lib/attendedSessionsUi'
import { RobotWave } from '../components/RobotArt'
import { todayISO, dayName, formatDisplayDate, addDays } from '../lib/dates'
import { isExpectedOnDate, findUnmarkedSessions, type UnmarkedSession } from '../lib/attendanceStats'
import type { Attendance, AttendedSession, Student, LessonRecord, StudentProgress, StudentRequiringAction } from '../types'

interface UpcomingStudent extends Student {
  progress: StudentProgress | null
}

interface DashboardData {
  expected: UpcomingStudent[]
  attendance: Attendance[]
  sessionsToday: Pick<AttendedSession, 'student_id' | 'outcome' | 'actual_lesson_id' | 'project_id'>[]
  recentLessons: LessonRecord[]
  totals: { total: number; active: number }
  needsAction: StudentRequiringAction[]
  feedbackOutstanding: number
  unmarked: UnmarkedSession[]
  pendingRequests: number
  needsLesson: number
}

export default function Dashboard() {
  const { profile, role } = useAuth()
  const { selectedCentreId, selectedCentre, isAllCentres, loading: centresLoading, error: centresError, refresh: refreshCentres } = useCentres()
  const { activeBrand } = useBrand()
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const today = todayISO()
  const scope = JSON.stringify([today, activeBrand, selectedCentreId, isAllCentres, centresLoading, centresError])
  const activeScope = useRef(scope)
  activeScope.current = scope
  const requestId = useRef(0)
  const [loadedScope, setLoadedScope] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (centresLoading || centresError || (!selectedCentreId && !isAllCentres)) return
    const requestedScope = JSON.stringify([today, activeBrand, selectedCentreId, isAllCentres, centresLoading, centresError])
    const request = ++requestId.current
    const isCurrent = () => request === requestId.current && activeScope.current === requestedScope
    setLoading(true)
    setError(null)
    const lookbackStart = addDays(today, -14)
    const yesterday = addDays(today, -1)

    try {
      // First resolve the current brand/centre's students. The views and
      // student-owned tables below do not all expose a centre_id column.
      let studentsQuery = supabase.from('students').select('*, student_schedules(day_of_week,start_time,active)').eq('brand', activeBrand).order('full_name')
      let requestsQuery = supabase.from('student_requests').select('id', { count: 'exact', head: true }).eq('status', 'pending').eq('brand', activeBrand)
      if (selectedCentreId) {
        studentsQuery = studentsQuery.eq('centre_id', selectedCentreId)
        requestsQuery = requestsQuery.eq('centre_id', selectedCentreId)
      }
      const [studentsRes, requestsRes] = await Promise.all([studentsQuery, requestsQuery])
      if (!isCurrent()) return
      if (studentsRes.error || requestsRes.error) throw studentsRes.error ?? requestsRes.error
      const students = (studentsRes.data ?? []) as Student[]
      const ids = students.map((student) => student.id)
      const empty = { data: [], error: null, count: 0 }
      let attendanceQuery = supabase.from('attendance').select('*').in('student_id', ids).eq('date', today)
      let sessionsQuery = supabase.from('attended_sessions').select('student_id,outcome,actual_lesson_id,project_id').in('student_id', ids).eq('date', today)
      if (selectedCentreId) {
        attendanceQuery = attendanceQuery.eq('centre_id', selectedCentreId)
        sessionsQuery = sessionsQuery.eq('centre_id', selectedCentreId)
      }
      // Never fall back to an unfiltered query for an empty centre.
      const [attendanceRes, lessonsRes, progressRes, actionRes, feedbackRes, recentAttRes, sessionsRes] = ids.length ? await Promise.all([
        attendanceQuery,
        supabase.from('lesson_records').select('*, profiles(name), levels(name)').in('student_id', ids).eq('status', 'completed').order('created_at', { ascending: false }).limit(8),
        supabase.from('student_progress').select('*').in('student_id', ids),
        supabase.from('students_requiring_assessment_action').select('*').in('student_id', ids),
        supabase.from('feedback_sheets').select('id', { count: 'exact', head: true }).in('student_id', ids).neq('status', 'given'),
        supabase.from('attendance').select('student_id,date').in('student_id', ids).gte('date', lookbackStart).lte('date', yesterday),
        sessionsQuery,
      ]) : [empty, empty, empty, empty, empty, empty, empty]
      if (!isCurrent()) return
      const queryError = attendanceRes.error ?? lessonsRes.error ?? progressRes.error ?? actionRes.error ?? feedbackRes.error ?? recentAttRes.error ?? sessionsRes.error
      if (queryError) throw queryError
      const progressMap = new Map(((progressRes.data ?? []) as StudentProgress[]).map((p) => [p.student_id, p]))
      const withProgress: UpcomingStudent[] = students.map((s) => ({ ...s, progress: progressMap.get(s.id) ?? null }))
      setData({
        expected: withProgress.filter((s) => s.active && (isExpectedOnDate(s, today) || attendanceRes.data?.some((a) => a.student_id === s.id) || sessionsRes.data?.some((session) => session.student_id === s.id))),
        attendance: (attendanceRes.data ?? []) as Attendance[],
        sessionsToday: (sessionsRes.data ?? []) as DashboardData['sessionsToday'],
        recentLessons: (lessonsRes.data ?? []) as LessonRecord[],
        totals: { total: students.length, active: students.filter((s) => s.active).length },
        needsAction: (actionRes.data ?? []) as StudentRequiringAction[],
        feedbackOutstanding: feedbackRes.count ?? 0,
        pendingRequests: requestsRes.count ?? 0,
        needsLesson: students.filter((s) => s.active && !s.current_lesson_id).length,
        unmarked: findUnmarkedSessions(students, (recentAttRes.data ?? []) as Attendance[], lookbackStart, yesterday),
      })
      setLoadedScope(requestedScope)
    } catch (failure) {
      if (!isCurrent()) return
      setError(failure && typeof failure === 'object' && 'message' in failure ? String(failure.message) : 'Unable to load dashboard')
      setLoadedScope(requestedScope)
    } finally {
      if (isCurrent()) setLoading(false)
    }
  }, [today, activeBrand, selectedCentreId, isAllCentres, centresLoading, centresError])

  useEffect(() => {
    void load()
    return () => { requestId.current++ }
  }, [load])

  if (centresLoading) return <LoadingPanel label="Loading working centre…" />
  if (centresError) return <ErrorPanel message={centresError} onRetry={() => void refreshCentres()} />
  if (!selectedCentreId && !isAllCentres) return <EmptyState title="No working centre available" hint="Please contact an administrator to check your centre assignment." />
  if (loading || loadedScope !== scope) return <LoadingPanel label="Loading dashboard…" />
  if (error) return <ErrorPanel message={error} onRetry={() => void load()} />
  if (!data) return null

  const attByStatus = (status: Attendance['status']) => data.attendance.filter((a) => a.status === status).length
  const attended = attByStatus('Arrived') + attByStatus('Completed')
  const absent = attByStatus('Absent')
  const attendanceByStudent = new Map(data.attendance.map((row) => [row.student_id, row]))
  const recordedStudents = new Set(data.sessionsToday.map((session) => session.student_id))
  const notMarked = data.expected.filter((student) => attendanceState(attendanceByStudent.get(student.id)?.status) === 'not_entered').length
  const upcoming = data.expected
    .filter((student) => attendanceState(attendanceByStudent.get(student.id)?.status) === 'not_entered' && !recordedStudents.has(student.id))
    .sort((a, b) => (a.preferred_time ?? '').localeCompare(b.preferred_time ?? ''))
  const incompleteEntries = data.expected.flatMap((student) => {
    const state = attendanceState(attendanceByStudent.get(student.id)?.status)
    if (state === 'attended' && !recordedStudents.has(student.id)) return [{ student, reason: 'Session details not recorded' }]
    if (state === 'not_entered' && recordedStudents.has(student.id)) return [{ student, reason: 'Session recorded — attendance mark still needed' }]
    return []
  })

  return (
    <div>
      <PageHeader
        title="Today at a glance"
        subtitle={`${formatDisplayDate(today)} · ${dayName(today)} · ${isAllCentres ? 'All centres' : selectedCentre?.name ?? 'Working centre'}`}
        accent="yellow"
        actions={
          <Link to="/register" className="btn-primary">
            Take Register
          </Link>
        }
      />
      <p className="text-sm text-slate-600 -mt-3 mb-4 flex items-center gap-2">
        <RobotWave className="w-9 h-9 -ml-1" />
        Signed in as <span className="font-medium">{profile?.name ?? 'staff'}</span>
      </p>

      <nav aria-label="Quick actions" className="flex flex-wrap gap-2 mb-6">
        <Link to="/register" className="btn-ghost text-sm">📋 Today's Register</Link>
        <Link to="/students" className="btn-ghost text-sm">🧑‍🎓 Students</Link>
        <Link to="/curriculum" className="btn-ghost text-sm">📚 Curriculum</Link>
        <Link to="/reports" className="btn-ghost text-sm">📊 Reports</Link>
      </nav>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard value={data.expected.length} label="Expected today" />
        <StatCard value={attended} label="Attended today" tone="good" />
        <StatCard value={absent} label="Absent" tone={absent > 0 ? 'bad' : undefined} />
        <StatCard value={data.feedbackOutstanding} label="Feedback outstanding" tone={data.feedbackOutstanding > 0 ? 'warn' : undefined} />
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        <section className="card p-4" aria-labelledby="upcoming-heading">
          <div className="flex items-center justify-between mb-3">
            <h3 id="upcoming-heading" className="font-semibold">Upcoming today</h3>
            <span className="badge">{upcoming.length} not arrived</span>
          </div>
          {upcoming.length === 0 ? (
            <EmptyState title="No arrivals outstanding" hint="Everyone expected has been marked attended or absent, or already has a recorded session." robot />
          ) : (
            <ul className="divide-y divide-slate-100">
              {upcoming.map((s) => {
                const att = data.attendance.find((a) => a.student_id === s.id)
                return (
                  <li key={s.id} className="py-2 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <Link to={`/students/${s.id}`} className="font-medium hover:underline truncate block">
                        {s.full_name}
                      </Link>
                      <div className="text-xs text-slate-600">
                        {s.preferred_time} · Lesson {s.progress?.current_lesson_number ?? '—'}
                      </div>
                    </div>
                    {att ? <StatusBadge status={att.status} /> : <span className="badge">Not Arrived</span>}
                  </li>
                )
              })}
            </ul>
          )}
        </section>

        <section className="card p-4">
          <h3 className="font-semibold mb-3">Recent lesson completions</h3>
          {data.recentLessons.length === 0 ? (
            <EmptyState title="No lessons recorded yet" />
          ) : (
            <ul className="divide-y divide-slate-100">
              {data.recentLessons.map((l) => (
                <li key={l.id} className="py-2 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <Link to={`/students/${l.student_id}`} className="font-medium hover:underline truncate block">
                      Lesson {l.lesson_number}
                    </Link>
                    <div className="text-xs text-slate-600">
                      {l.levels?.name ?? `Level ${l.level_id}`} · {l.profiles?.name ?? 'Unassigned'}
                    </div>
                  </div>
                  <span className="text-xs text-slate-600 whitespace-nowrap">{l.date}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {incompleteEntries.length > 0 && (
        <div className="mt-4">
          <CollapsiblePanel title="Register entries to finish" countLabel={`${incompleteEntries.length} pending`} accent="yellow">
            <p className="text-sm text-slate-600 mb-3">Complete the missing register details below. Saved sessions do not need to be recorded again.</p>
            <ul className="space-y-2 mb-3">
              {incompleteEntries.map(({ student, reason }) => <li key={student.id} className="text-sm"><Link to={`/students/${student.id}`} className="font-medium hover:underline">{student.full_name}</Link><span className="text-slate-600"> · {reason}</span></li>)}
            </ul>
            <Link to="/register" className="btn-ghost">Open register</Link>
          </CollapsiblePanel>
        </div>
      )}

      {data.needsLesson > 0 && (
        <Link to="/students?filter=needs-lesson" className="card card-hover p-4 mt-6 flex items-center justify-between gap-3 border-amber-200">
          <span className="text-sm">
            <span className="font-semibold">{data.needsLesson} student{data.needsLesson === 1 ? '' : 's'}</span> still need a starting lesson
          </span>
          <span className="btn-ghost text-xs">Choose</span>
        </Link>
      )}

      {role === 'admin' && data.pendingRequests > 0 && (
        <Link to="/requests" className="card card-hover p-4 mt-6 flex items-center justify-between gap-3 border-amber-200">
          <span className="text-sm">
            <span className="font-semibold">{data.pendingRequests} student request{data.pendingRequests === 1 ? '' : 's'}</span> waiting for review
          </span>
          <span className="btn-ghost text-xs">Review</span>
        </Link>
      )}

      <section className="card p-4 mt-6" aria-labelledby="unmarked-heading">
        <div className="flex items-center justify-between mb-1">
          <h3 id="unmarked-heading" className="font-semibold">Registers still to fill in</h3>
          <span className={`badge ${data.unmarked.length > 0 ? 'badge-assess' : ''}`}>{data.unmarked.length}</span>
        </div>
        <p className="text-xs text-slate-600 mb-3">
          Students who were expected in the last 14 days but have no attendance mark at all. Nothing is counted against
          them until you mark Attended or Absent.
        </p>
        {data.unmarked.length === 0 ? (
          <EmptyState title="Every recent register is complete" />
        ) : (
          <ul className="divide-y divide-slate-100">
            {data.unmarked.slice(0, 12).map(({ date, student }) => (
              <li key={`${student.id}-${date}`} className="py-2 flex items-center justify-between gap-3 text-sm">
                <div className="min-w-0">
                  <Link to={`/students/${student.id}`} className="font-medium hover:underline truncate block">{student.full_name}</Link>
                  <span className="text-xs text-slate-600">{dayName(date)} {formatDisplayDate(date)}</span>
                </div>
                <Link to={`/register?date=${date}`} className="btn-ghost text-xs whitespace-nowrap">Open register</Link>
              </li>
            ))}
          </ul>
        )}
        {data.unmarked.length > 12 && (
          <p className="text-xs text-slate-600 mt-2">Showing the 12 most recent of {data.unmarked.length}.</p>
        )}
      </section>

      <section className="card p-4 mt-6">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold">Needs assessment / remediation follow-up</h3>
          <span className="badge">{data.needsAction.length}</span>
        </div>
        {data.needsAction.length === 0 ? (
          <EmptyState title="Nobody currently needs assessment or remediation follow-up" />
        ) : (
          <ul className="divide-y divide-slate-100">
            {data.needsAction.map((a) => (
              <li key={`${a.student_id}-${a.action}`} className="py-2 flex items-center justify-between gap-3 text-sm">
                <div>
                  <Link to={`/students/${a.student_id}`} className="font-medium hover:underline">{a.full_name}</Link>
                  <span className="text-slate-600"> · {a.current_level}</span>
                </div>
                <span className="badge badge-assess">{a.action}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card p-4 mt-6">
        <h3 className="font-semibold mb-3">Students</h3>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4 text-sm">
          <div className="bg-slate-50 rounded-lg p-3">
            <div className="text-xl font-bold">{data.totals.total}</div>
            <div className="text-slate-600">Total students</div>
          </div>
          <div className="bg-slate-50 rounded-lg p-3">
            <div className="text-xl font-bold">{data.totals.active}</div>
            <div className="text-slate-600">Active</div>
          </div>
          <div className="bg-slate-50 rounded-lg p-3">
            <div className="text-xl font-bold">{data.sessionsToday.length}</div>
            <div className="text-slate-600">Sessions recorded today</div>
          </div>
          <div className="bg-slate-50 rounded-lg p-3">
            <div className="text-xl font-bold">{notMarked}</div>
            <div className="text-slate-600">Awaiting register mark</div>
          </div>
        </div>
        <Link to="/students" className="text-sm text-[color:var(--rt-primary)] font-medium hover:underline">
          View all students →
        </Link>
      </section>
    </div>
  )
}
