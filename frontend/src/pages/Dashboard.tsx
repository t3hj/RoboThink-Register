import { useEffect, useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../lib/auth'
import { PageHeader, StatCard, LoadingPanel, ErrorPanel, EmptyState, StatusBadge } from '../components/ui'
import { RobotWave } from '../components/RobotArt'
import { todayISO, dayName, formatDisplayDate, addDays } from '../lib/dates'
import { isExpectedOnDate, findUnmarkedSessions, type UnmarkedSession } from '../lib/attendanceStats'
import type { Attendance, Student, LessonRecord, StudentProgress, StudentRequiringAction } from '../types'

interface UpcomingStudent extends Student {
  progress: StudentProgress | null
}

interface DashboardData {
  expected: UpcomingStudent[]
  attendance: Attendance[]
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
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const today = todayISO()

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const lookbackStart = addDays(today, -14)
    const yesterday = addDays(today, -1)

    const [studentsRes, attendanceRes, lessonsRes, progressRes, actionRes, feedbackRes, recentAttRes, requestsRes] = await Promise.all([
      supabase.from('students').select('*, student_schedules(day_of_week,start_time,active)').order('full_name'),
      supabase.from('attendance').select('*').eq('date', today),
      supabase
        .from('lesson_records')
        .select('*, profiles(name), levels(name)')
        .eq('status', 'completed')
        .order('created_at', { ascending: false })
        .limit(8),
      supabase.from('student_progress').select('*'),
      supabase.from('students_requiring_assessment_action').select('*'),
      supabase.from('feedback_sheets').select('id', { count: 'exact', head: true }).neq('status', 'given'),
      supabase.from('attendance').select('student_id,date').gte('date', lookbackStart).lte('date', yesterday),
      supabase.from('student_requests').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
    ])

    if (studentsRes.error || recentAttRes.error || attendanceRes.error || lessonsRes.error || progressRes.error || actionRes.error || feedbackRes.error) {
      setError(
        studentsRes.error?.message ??
          recentAttRes.error?.message ??
          attendanceRes.error?.message ??
          lessonsRes.error?.message ??
          progressRes.error?.message ??
          actionRes.error?.message ??
          feedbackRes.error?.message ??
          'Unknown database error',
      )
      setLoading(false)
      return
    }

    const students = (studentsRes.data ?? []) as Student[]
    const progressMap = new Map(((progressRes.data ?? []) as StudentProgress[]).map((p) => [p.student_id, p]))
    const withProgress: UpcomingStudent[] = students.map((s) => ({ ...s, progress: progressMap.get(s.id) ?? null }))

    setData({
      expected: withProgress.filter(
        (s) => s.active && (isExpectedOnDate(s, today) || attendanceRes.data?.some((a) => a.student_id === s.id)),
      ),
      attendance: (attendanceRes.data ?? []) as Attendance[],
      recentLessons: (lessonsRes.data ?? []) as LessonRecord[],
      totals: { total: students.length, active: students.filter((s) => s.active).length },
      needsAction: (actionRes.data ?? []) as StudentRequiringAction[],
      feedbackOutstanding: feedbackRes.count ?? 0,
      pendingRequests: requestsRes.count ?? 0,
      needsLesson: students.filter((s) => s.active && !s.current_lesson_id).length,
      unmarked: findUnmarkedSessions(students, (recentAttRes.data ?? []) as Attendance[], lookbackStart, yesterday),
    })
    setLoading(false)
  }, [today])

  useEffect(() => {
    void load()
  }, [load])

  if (loading) return <LoadingPanel label="Loading dashboard…" />
  if (error) return <ErrorPanel message={error} onRetry={() => void load()} />
  if (!data) return null

  const attByStatus = (status: Attendance['status']) => data.attendance.filter((a) => a.status === status).length
  const arrived = attByStatus('Arrived')
  const absent = attByStatus('Absent')
  const completedToday = attByStatus('Completed')
  const notMarked = data.expected.filter((s) => !data.attendance.some((a) => a.student_id === s.id)).length
  const upcoming = data.expected
    .filter((s) => !['Completed', 'Absent'].includes(data.attendance.find((a) => a.student_id === s.id)?.status ?? ''))
    .sort((a, b) => (a.preferred_time ?? '').localeCompare(b.preferred_time ?? ''))

  return (
    <div>
      <PageHeader
        title="Today at a glance"
        subtitle={`${formatDisplayDate(today)} · ${dayName(today)}`}
        accent="yellow"
        actions={
          <Link to="/register" className="btn-primary">
            Take Register
          </Link>
        }
      />
      <p className="text-sm text-slate-500 -mt-3 mb-4 flex items-center gap-2">
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
        <StatCard value={arrived} label="In centre now" tone="good" />
        <StatCard value={absent} label="Absent" tone={absent > 0 ? 'bad' : undefined} />
        <StatCard value={data.feedbackOutstanding} label="Feedback outstanding" tone={data.feedbackOutstanding > 0 ? 'warn' : undefined} />
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        <section className="card p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold">Upcoming today</h3>
            <span className="badge">{notMarked} not marked</span>
          </div>
          {upcoming.length === 0 ? (
            <EmptyState title="No sessions remaining today" hint="Everyone is marked in, done, or absent." robot />
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
                      <div className="text-xs text-slate-500">
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
                    <div className="text-xs text-slate-500">
                      {l.levels?.name ?? `Level ${l.level_id}`} · {l.profiles?.name ?? 'Unassigned'}
                    </div>
                  </div>
                  <span className="text-xs text-slate-500 whitespace-nowrap">{l.date}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

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
        <p className="text-xs text-slate-500 mb-3">
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
                  <span className="text-xs text-slate-500">{dayName(date)} {formatDisplayDate(date)}</span>
                </div>
                <Link to={`/register?date=${date}`} className="btn-ghost text-xs whitespace-nowrap">Open register</Link>
              </li>
            ))}
          </ul>
        )}
        {data.unmarked.length > 12 && (
          <p className="text-xs text-slate-500 mt-2">Showing the 12 most recent of {data.unmarked.length}.</p>
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
                  <span className="text-slate-500"> · {a.current_level}</span>
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
            <div className="text-slate-500">Total students</div>
          </div>
          <div className="bg-slate-50 rounded-lg p-3">
            <div className="text-xl font-bold">{data.totals.active}</div>
            <div className="text-slate-500">Active</div>
          </div>
          <div className="bg-slate-50 rounded-lg p-3">
            <div className="text-xl font-bold">{completedToday}</div>
            <div className="text-slate-500">Lessons done today</div>
          </div>
          <div className="bg-slate-50 rounded-lg p-3">
            <div className="text-xl font-bold">{notMarked}</div>
            <div className="text-slate-500">Awaiting register mark</div>
          </div>
        </div>
        <Link to="/students" className="text-sm text-[color:var(--rt-primary)] font-medium hover:underline">
          View all students →
        </Link>
      </section>
    </div>
  )
}
