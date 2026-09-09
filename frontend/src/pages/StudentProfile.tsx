import { useCallback, useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../lib/auth'
import { useToast } from '../components/Toast'
import { PageHeader, LoadingPanel, ErrorPanel, EmptyState, StatusBadge, StatCard } from '../components/ui'
import { formatShortDate, formatDisplayDate } from '../lib/dates'
import type { Attendance, LessonRecord, Student } from '../types'

export default function StudentProfile() {
  const { id } = useParams<{ id: string }>()
  const { role } = useAuth()
  const { notify } = useToast()
  const [student, setStudent] = useState<Student | null>(null)
  const [lessons, setLessons] = useState<LessonRecord[]>([])
  const [attendance, setAttendance] = useState<Attendance[]>([])
  const [nextLesson, setNextLesson] = useState<number | null>(null)
  const [totalLessons, setTotalLessons] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!id) return
    setLoading(true)
    setError(null)
    const [sRes, lRes, aRes, pRes] = await Promise.all([
      supabase.from('students').select('*, levels(name), subscriptions(name)').eq('id', id).maybeSingle(),
      supabase
        .from('lesson_records')
        .select('*, profiles(name), levels(name)')
        .eq('student_id', id)
        .order('date', { ascending: false }),
      supabase.from('attendance').select('*').eq('student_id', id).order('date', { ascending: false }),
      supabase.from('student_progress').select('next_lesson, total_lessons').eq('student_id', id).maybeSingle(),
    ])
    if (sRes.error || lRes.error || aRes.error || pRes.error) {
      setError(sRes.error?.message ?? lRes.error?.message ?? aRes.error?.message ?? pRes.error?.message ?? 'Unknown error')
      setLoading(false)
      return
    }
    setStudent((sRes.data ?? null) as Student | null)
    setLessons((lRes.data ?? []) as LessonRecord[])
    setAttendance((aRes.data ?? []) as Attendance[])
    const p = pRes.data as { next_lesson: number | null; total_lessons: number | null } | null
    setNextLesson(p?.next_lesson ?? null)
    setTotalLessons(p?.total_lessons ?? null)
    setLoading(false)
  }, [id])

  useEffect(() => {
    void load()
  }, [load])

  async function clearOverride() {
    if (!id || !student?.override_next_lesson) return
    const { error: err } = await supabase.from('students').update({ override_next_lesson: null }).eq('id', id)
    if (err) {
      notify(err.message, 'error')
      return
    }
    notify('Progress override cleared', 'success')
    void load()
  }

  if (loading) return <LoadingPanel label="Loading student…" />
  if (error) return <ErrorPanel message={error} onRetry={() => void load()} />
  if (!student) {
    return (
      <EmptyState
        title="Student not found"
        hint="They may have been removed, or you don't have access."
      />
    )
  }

  const completed = lessons.filter((l) => l.status === 'completed').length
  const attended = attendance.filter((a) => a.status === 'Completed' || a.status === 'Arrived').length
  const absent = attendance.filter((a) => a.status === 'Absent').length
  const relevant = attended + absent
  const attendancePct = relevant ? Math.round((attended / relevant) * 100) : null

  return (
    <div>
      <PageHeader
        title={student.full_name}
        subtitle={[
          student.levels?.name ?? `Level ${student.current_level_id ?? '—'}`,
          student.preferred_day ? `${student.preferred_day} ${student.preferred_time ?? ''}`.trim() : null,
          student.parent_name,
        ]
          .filter(Boolean)
          .join(' · ')}
        actions={
          student.override_next_lesson != null && role === 'admin' ? (
            <button className="btn-ghost" onClick={() => void clearOverride()}>
              Clear override ({student.override_next_lesson})
            </button>
          ) : undefined
        }
      />
      <Link to="/students" className="text-sm text-slate-500 hover:underline">← Back to students</Link>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 my-5">
        <StatCard value={completed} label="Lessons completed" />
        <StatCard value={nextLesson ?? '—'} label={`Next lesson${totalLessons ? ` of ${totalLessons}` : ''}`} />
        <StatCard
          value={attendancePct == null ? '—' : `${attendancePct}%`}
          label="Attendance"
          tone={attendancePct != null && attendancePct < 80 ? 'warn' : 'good'}
        />
        <StatCard value={absent} label="Absences" tone={absent > 2 ? 'bad' : undefined} />
      </div>

      {student.override_next_lesson != null && (
        <div className="card p-4 mb-5 border-amber-200 bg-amber-50 text-sm text-amber-800">
          Next-lesson override is active (set to {student.override_next_lesson}).
          {role !== 'admin' && ' Only an admin can clear it.'}
        </div>
      )}

      <div className="grid md:grid-cols-3 gap-6">
        <div className="card p-4">
          <h3 className="font-semibold mb-3">Details</h3>
          <dl className="text-sm space-y-2">
            <div><dt className="text-slate-500">Parent</dt><dd>{student.parent_name ?? '—'}</dd></div>
            <div><dt className="text-slate-500">Contact</dt><dd>{student.parent_contact ?? '—'}</dd></div>
            <div><dt className="text-slate-500">Subscription</dt><dd>{student.subscriptions?.name ?? '—'}</dd></div>
            <div><dt className="text-slate-500">Joined</dt><dd>{student.date_joined ? formatDisplayDate(student.date_joined) : '—'}</dd></div>
            {student.notes && (
              <div><dt className="text-slate-500">Notes</dt><dd className="whitespace-pre-wrap">{student.notes}</dd></div>
            )}
          </dl>
        </div>

        <div className="card p-4 md:col-span-2">
          <h3 className="font-semibold mb-3">Lesson history</h3>
          {lessons.length === 0 ? (
            <EmptyState title="No lessons recorded" />
          ) : (
            <ul className="divide-y divide-slate-100">
              {lessons.map((l) => (
                <li key={l.id} className="py-2 flex items-center justify-between gap-3 text-sm">
                  <div>
                    <span className="font-medium">Lesson {l.lesson_number}</span>
                    <span className="text-slate-500"> · {l.levels?.name ?? `Level ${l.level_id}`}</span>
                    {l.status !== 'completed' && <span className="badge ml-2">{l.status}</span>}
                  </div>
                  <div className="text-slate-500 text-xs whitespace-nowrap">
                    {formatShortDate(l.date)} · {l.profiles?.name ?? 'Unassigned'}
                  </div>
                </li>
              ))}
            </ul>
          )}

          <h3 className="font-semibold mt-5 mb-3">Attendance</h3>
          {attendance.length === 0 ? (
            <EmptyState title="No attendance recorded" />
          ) : (
            <ul className="divide-y divide-slate-100">
              {attendance.map((a) => (
                <li key={a.id} className="py-2 flex items-center justify-between gap-3 text-sm">
                  <div className="flex items-center gap-2">
                    {formatShortDate(a.date)}
                    {a.catch_up && <span className="badge">Catch-up</span>}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-500">{a.time_in ?? '–'} → {a.time_out ?? '–'}</span>
                    <StatusBadge status={a.status} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
