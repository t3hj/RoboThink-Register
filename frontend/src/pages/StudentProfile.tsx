import { useCallback, useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../lib/auth'
import { PageHeader, LoadingPanel, ErrorPanel, EmptyState, StatusBadge, StatCard } from '../components/ui'
import ChangeLessonControl from '../components/ChangeLessonControl'
import AssessmentPanel from '../components/AssessmentPanel'
import StudentForm from '../components/StudentForm'
import { loadCurriculum } from '../lib/curriculumData'
import { levelLabel } from '../lib/curriculum'
import { formatShortDate, formatDisplayDate } from '../lib/dates'
import type {
  Assessment,
  Attendance,
  Level,
  Lesson,
  LessonRecord,
  RemediationLesson,
  RemediationPlan,
  Student,
  StudentProgress,
} from '../types'

export default function StudentProfile() {
  const { id } = useParams<{ id: string }>()
  const { role } = useAuth()
  const [student, setStudent] = useState<Student | null>(null)
  const [progress, setProgress] = useState<StudentProgress | null>(null)
  const [plan, setPlan] = useState<RemediationPlan | null>(null)
  const [lessons, setLessons] = useState<LessonRecord[]>([])
  const [remediationLessons, setRemediationLessons] = useState<RemediationLesson[]>([])
  const [assessments, setAssessments] = useState<Assessment[]>([])
  const [attendance, setAttendance] = useState<Attendance[]>([])
  const [levels, setLevels] = useState<Level[]>([])
  const [curriculumLessons, setCurriculumLessons] = useState<Lesson[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)

  const load = useCallback(async () => {
    if (!id) return
    setLoading(true)
    setError(null)
    const [sRes, pRes, planRes, lRes, rRes, aRes, attRes, curriculum] = await Promise.all([
      supabase.from('students').select('*, levels(name), subscriptions(name)').eq('id', id).maybeSingle(),
      supabase.from('student_progress').select('*').eq('student_id', id).maybeSingle(),
      supabase
        .from('remediation_plans')
        .select('*')
        .eq('student_id', id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from('lesson_records')
        .select('*, profiles(name), levels(name), lessons(title)')
        .eq('student_id', id)
        .order('date', { ascending: false }),
      supabase
        .from('remediation_lessons')
        .select('*, profiles(name)')
        .eq('student_id', id)
        .order('date', { ascending: false }),
      supabase
        .from('assessments')
        .select('*, profiles(name), levels(name)')
        .eq('student_id', id)
        .order('date', { ascending: false }),
      supabase.from('attendance').select('*').eq('student_id', id).order('date', { ascending: false }),
      loadCurriculum(),
    ])
    if (sRes.error || pRes.error || lRes.error || rRes.error || aRes.error || attRes.error) {
      setError(
        sRes.error?.message ??
          pRes.error?.message ??
          lRes.error?.message ??
          rRes.error?.message ??
          aRes.error?.message ??
          attRes.error?.message ??
          'Unknown error',
      )
      setLoading(false)
      return
    }
    setStudent((sRes.data ?? null) as Student | null)
    setProgress((pRes.data ?? null) as StudentProgress | null)
    setPlan(
      planRes.data && ['required', 'in_progress', 'ready_for_reassessment', 'intervention_required'].includes((planRes.data as RemediationPlan).status)
        ? (planRes.data as RemediationPlan)
        : null,
    )
    setLessons((lRes.data ?? []) as LessonRecord[])
    setRemediationLessons((rRes.data ?? []) as RemediationLesson[])
    setAssessments((aRes.data ?? []) as Assessment[])
    setAttendance((attRes.data ?? []) as Attendance[])
    setLevels(curriculum.levels)
    setCurriculumLessons(curriculum.lessons)
    setLoading(false)
  }, [id])

  useEffect(() => {
    void load()
  }, [load])

  if (loading) return <LoadingPanel label="Loading student…" />
  if (error) return <ErrorPanel message={error} onRetry={() => void load()} />
  if (!student) {
    return <EmptyState title="Student not found" hint="They may have been removed, or you don't have access." />
  }

  const completed = lessons.filter((l) => l.status === 'completed').length
  const attended = attendance.filter((a) => a.status === 'Completed' || a.status === 'Arrived').length
  const absent = attendance.filter((a) => a.status === 'Absent').length
  const relevant = attended + absent
  const attendancePct = relevant ? Math.round((attended / relevant) * 100) : null
  const needsAction = progress && progress.current_kind !== 'normal' && progress.current_kind !== 'complete'

  return (
    <div>
      <PageHeader
        title={student.full_name}
        subtitle={[
          progress ? levelLabel({ name: progress.level_name ?? '' }) : student.levels?.name ?? '—',
          student.preferred_day ? `${student.preferred_day} ${student.preferred_time ?? ''}`.trim() : null,
          student.parent_name,
        ]
          .filter(Boolean)
          .join(' · ')}
        accent="blue"
        actions={
          role === 'admin' ? (
            <button className="btn-ghost" onClick={() => setEditing(true)}>
              Edit details
            </button>
          ) : undefined
        }
      />
      <Link to="/students" className="text-sm text-slate-500 hover:underline">← Back to students</Link>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 my-5">
        <StatCard value={completed} label="Lessons completed" />
        <StatCard
          value={progress?.current_lesson_number ?? '—'}
          label="Current lesson"
        />
        <StatCard
          value={attendancePct == null ? '—' : `${attendancePct}%`}
          label="Attendance"
          tone={attendancePct != null && attendancePct < 80 ? 'warn' : 'good'}
        />
        <StatCard value={absent} label="Absences" tone={absent > 2 ? 'bad' : undefined} />
      </div>

      <div className="card p-4 mb-5">
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <div className="text-xs uppercase tracking-wide text-slate-400 mb-1">Current lesson</div>
            <div className="font-semibold">
              {progress?.current_lesson_number != null
                ? `${levelLabel({ name: progress.level_name ?? '' })} — Lesson ${progress.current_lesson_number}${progress.current_lesson_title ? `: ${progress.current_lesson_title}` : ''}`
                : 'Curriculum complete'}
            </div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-slate-400 mb-1">Next lesson</div>
            <div className="font-semibold">
              {progress?.next_lesson_number != null
                ? `${levelLabel({ name: progress.level_name ?? '' })} — Lesson ${progress.next_lesson_number}${progress.next_lesson_title ? `: ${progress.next_lesson_title}` : ''}`
                : '—'}
            </div>
          </div>
        </div>
        {role === 'admin' && (
          <div className="mt-4">
            <ChangeLessonControl
              studentId={student.id}
              levels={levels}
              lessons={curriculumLessons}
              currentLevelId={student.current_level_id}
              onDone={() => void load()}
            />
          </div>
        )}
      </div>

      {needsAction && (
        <div className="mb-5">
          <AssessmentPanel
            studentId={student.id}
            studentName={student.full_name}
            pendingAssessmentPointId={student.pending_assessment_point_id}
            focusTopic={progress?.focus_topic ?? null}
            plan={plan}
            onDone={() => void load()}
          />
        </div>
      )}

      <div className="grid md:grid-cols-3 gap-6">
        <div className="card p-4">
          <h3 className="font-semibold mb-3">Details</h3>
          <dl className="text-sm space-y-2">
            <div><dt className="text-slate-500">Date of birth</dt><dd>{student.date_of_birth ? formatDisplayDate(student.date_of_birth) : '—'}</dd></div>
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
                    <span className="font-medium">Lesson {l.lesson_number}{l.lessons?.title ? `: ${l.lessons.title}` : ''}</span>
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

          {(assessments.length > 0 || remediationLessons.length > 0) && (
            <>
              <h3 className="font-semibold mt-5 mb-3">Assessments & remediation</h3>
              <ul className="divide-y divide-slate-100">
                {assessments.map((a) => (
                  <li key={a.id} className="py-2 flex items-center justify-between gap-3 text-sm">
                    <div>
                      <span className={`font-medium ${a.passed ? 'text-emerald-700' : 'text-rose-700'}`}>
                        {a.passed ? 'PASS' : 'FAIL'}
                      </span>
                      <span className="text-slate-500"> · attempt {a.attempt_number}</span>
                    </div>
                    <div className="text-slate-500 text-xs whitespace-nowrap">
                      {formatShortDate(a.date)} · {a.profiles?.name ?? 'Unassigned'}
                    </div>
                  </li>
                ))}
                {remediationLessons.map((r) => (
                  <li key={r.id} className="py-2 flex items-center justify-between gap-3 text-sm">
                    <div>
                      <span className="font-medium">Remediation lesson {r.lesson_number}</span>
                      {r.topic && <span className="text-slate-500"> · {r.topic}</span>}
                    </div>
                    <div className="text-slate-500 text-xs whitespace-nowrap">
                      {formatShortDate(r.date)} · {r.profiles?.name ?? 'Unassigned'}
                    </div>
                  </li>
                ))}
              </ul>
            </>
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

      {editing && (
        <StudentForm
          student={student}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false)
            void load()
          }}
        />
      )}
    </div>
  )
}
