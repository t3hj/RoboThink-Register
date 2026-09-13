import { useEffect, useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../lib/auth'
import { PageHeader, StatCard, LoadingPanel, ErrorPanel, EmptyState, StatusBadge } from '../components/ui'
import { todayISO, dayName, formatDisplayDate } from '../lib/dates'
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
}

export default function Dashboard() {
  const { profile } = useAuth()
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const today = todayISO()

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const dow = dayName(today)

    const [studentsRes, attendanceRes, lessonsRes, progressRes, actionRes] = await Promise.all([
      supabase.from('students').select('*').order('full_name'),
      supabase.from('attendance').select('*').eq('date', today),
      supabase
        .from('lesson_records')
        .select('*, profiles(name), levels(name)')
        .eq('status', 'completed')
        .order('created_at', { ascending: false })
        .limit(8),
      supabase.from('student_progress').select('*'),
      supabase.from('students_requiring_assessment_action').select('*'),
    ])

    if (studentsRes.error || attendanceRes.error || lessonsRes.error || progressRes.error || actionRes.error) {
      setError(
        studentsRes.error?.message ??
          attendanceRes.error?.message ??
          lessonsRes.error?.message ??
          progressRes.error?.message ??
          actionRes.error?.message ??
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
        (s) => s.active && (s.preferred_day === dow || attendanceRes.data?.some((a) => a.student_id === s.id)),
      ),
      attendance: (attendanceRes.data ?? []) as Attendance[],
      recentLessons: (lessonsRes.data ?? []) as LessonRecord[],
      totals: { total: students.length, active: students.filter((s) => s.active).length },
      needsAction: (actionRes.data ?? []) as StudentRequiringAction[],
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
        actions={
          <Link to="/register" className="btn-primary">
            Take Register
          </Link>
        }
      />
      <p className="text-sm text-slate-500 -mt-3 mb-5">
        Signed in as <span className="font-medium">{profile?.name ?? 'staff'}</span>
      </p>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard value={data.expected.length} label="Expected today" />
        <StatCard value={arrived} label="In centre now" tone="good" />
        <StatCard value={absent} label="Absent" tone={absent > 0 ? 'bad' : undefined} />
        <StatCard value={completedToday} label="Lessons done today" />
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        <section className="card p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold">Upcoming today</h3>
            <span className="badge">{notMarked} not marked</span>
          </div>
          {upcoming.length === 0 ? (
            <EmptyState title="No sessions remaining today" hint="Everyone is marked in, done, or absent." />
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
            <div className="text-xl font-bold">{data.totals.total - data.totals.active}</div>
            <div className="text-slate-500">Inactive</div>
          </div>
          <div className="bg-slate-50 rounded-lg p-3">
            <div className="text-xl font-bold">{notMarked}</div>
            <div className="text-slate-500">Awaiting register mark</div>
          </div>
        </div>
        <Link to="/students" className="text-sm text-[color:var(--rt-teal)] font-medium hover:underline">
          View all students →
        </Link>
      </section>
    </div>
  )
}
