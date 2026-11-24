import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { fetchAllRows } from '../lib/pagination'
import { PageHeader, LoadingPanel, ErrorPanel, EmptyState, StatCard } from '../components/ui'
import { addDays, todayISO } from '../lib/dates'
import { curriculumCompletions } from '../lib/curriculumCompletions'
import { countKinds, rateFromSummary } from '../lib/attendanceStats'
import { studentAttendance } from '../lib/studentAttendance'
import { loadCurriculum } from '../lib/curriculumData'
import type { AssessmentPoint, AttendedSession, Assessment, Attendance, LessonRecord, RemediationPlan, Student } from '../types'

type Range = '7' | '30' | '90' | 'custom'

export default function Reports() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [range, setRange] = useState<Range>('30')
  const [from, setFrom] = useState(addDays(todayISO(), -29))
  const [to, setTo] = useState(todayISO())
  const [studentFilter, setStudentFilter] = useState('all')

  const [levelNames, setLevelNames] = useState(new Map<number, string>())
  const [visitsInRange, setVisitsInRange] = useState<ReturnType<typeof studentAttendance>['rows']>([])
  const [appliedPeriod, setAppliedPeriod] = useState({ from, to })
  const [attendance, setAttendance] = useState<Attendance[]>([])
  const [lessons, setLessons] = useState<ReturnType<typeof curriculumCompletions>>([])
  const [students, setStudents] = useState<Student[]>([])
  const [assessments, setAssessments] = useState<Assessment[]>([])
  const [remediationPlans, setRemediationPlans] = useState<RemediationPlan[]>([])

  const readReport = useCallback(async (fromDate: string, toDate: string) => {
    setLoading(true)
    setError(null)
    const [aRes, lRes, sRes, asRes, rpRes, vRes, points, curriculum, sessionDates] = await Promise.all([
      fetchAllRows(() => supabase.from('attendance').select('id,student_id,date,status,session_type,catch_up').lte('date', todayISO()).order('id')),
      fetchAllRows(() => supabase.from('lesson_records').select('*, profiles(name), attended_sessions(id)')
        .eq('status', 'completed').gte('date', fromDate).lte('date', toDate).order('id')),
      fetchAllRows(() => supabase.from('students').select('*').order('full_name').order('id')),
      fetchAllRows(() => supabase.from('assessments').select('*, profiles(name)').gte('date', fromDate).lte('date', toDate).order('id')),
      fetchAllRows(() => supabase.from('remediation_plans').select('*').neq('status', 'completed').order('id')),
      fetchAllRows(() => supabase.from('attended_sessions').select('id,student_id,date,outcome,actual_lesson_id,lesson_record_id,project_id,remediation_title,remediation_lessons(id),profiles(name)').gte('date', fromDate).lte('date', toDate).order('id')),
      fetchAllRows(() => supabase.from('assessment_points').select('id,after_lesson_id').order('id')),
      loadCurriculum(),
      fetchAllRows(() => supabase.from('attended_sessions').select('id,student_id,date,session_number').lte('date', todayISO()).order('id')),
    ])
    if (aRes.error || lRes.error || sRes.error || asRes.error || rpRes.error || vRes.error || points.error || sessionDates.error) {
      setError(
        aRes.error?.message ?? lRes.error?.message ?? sRes.error?.message ?? asRes.error?.message ?? rpRes.error?.message ?? vRes.error?.message ?? points.error?.message ?? sessionDates.error?.message ?? 'Unknown error',
      )
      setLoading(false)
      return
    }
    // Match make-ups across the whole history before selecting report dates.
    const marks = (aRes.data ?? []) as Attendance[]
    const grouped = <T extends { student_id: string }>(rows: T[]) => {
      const groups = new Map<string, T[]>()
      for (const row of rows) {
        const existing = groups.get(row.student_id)
        if (existing) existing.push(row)
        else groups.set(row.student_id, [row])
      }
      return groups
    }
    const marksByStudent = grouped(marks)
    const sessionsByStudent = grouped((sessionDates.data ?? []) as Pick<AttendedSession, 'id' | 'student_id' | 'session_number' | 'date'>[])
    const withinRange = (row: { date: string }) => row.date >= fromDate && row.date <= toDate
    setVisitsInRange((sRes.data ?? []).flatMap(student => studentAttendance(
      marksByStudent.get(student.id) ?? [], sessionsByStudent.get(student.id) ?? [], todayISO()
    ).rows.filter(withinRange)))
    setAttendance(marks.filter(withinRange))
    setAppliedPeriod({ from: fromDate, to: toDate })
    setLevelNames(new Map(curriculum.levels.map(level => [level.id, level.name])))
    setLessons(curriculumCompletions(curriculum.lessons, (vRes.data ?? []) as unknown as AttendedSession[], (lRes.data ?? []) as LessonRecord[],
      (asRes.data ?? []) as Assessment[], (points.data ?? []) as AssessmentPoint[], todayISO()))
    setStudents((sRes.data ?? []) as Student[])
    setAssessments((asRes.data ?? []) as Assessment[])
    setRemediationPlans((rpRes.data ?? []) as RemediationPlan[])
    setLoading(false)
  }, [])

  const load = useCallback(async (start: string, end: string) => {
    try {
      await readReport(start, end)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Unable to load report')
      setLoading(false)
    }
  }, [readReport])

  useEffect(() => {
    void load(from, to)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function applyRange() {
    const days = Number(range)
    if (range === 'custom') {
      void load(from, to)
    } else {
      const f = addDays(todayISO(), -days + 1)
      setFrom(f)
      setTo(todayISO())
      void load(f, todayISO())
    }
  }

  // ---- attendance summary ----
  const attSummary = useMemo(() => {
    const rows = studentFilter === 'all' ? attendance : attendance.filter((a) => a.student_id === studentFilter)
    const visits = visitsInRange.filter(row => studentFilter === 'all' || row.student_id === studentFilter)
    const summary = countKinds(visits)
    return { present: summary.attended + summary.extra, absent: summary.missed, pct: rateFromSummary(summary), marks: rows.length }
  }, [attendance, studentFilter, visitsInRange])

  // ---- lesson progress ----
  const lessonSummary = useMemo(() => {
    const rows = studentFilter === 'all' ? lessons : lessons.filter((l) => l.student_id === studentFilter)
    const byInstructor = new Map<string, number>()
    const byLevel = new Map<string, number>()
    const byStudent = new Map<string, number>()
    for (const l of rows) {
      const instructor = l.profiles?.name ?? 'Unassigned'
      byInstructor.set(instructor, (byInstructor.get(instructor) ?? 0) + 1)
      const level = levelNames.get(l.lesson.level_id) ?? `Level ${l.lesson.level_id}`
      byLevel.set(level, (byLevel.get(level) ?? 0) + 1)
      byStudent.set(l.student_id, (byStudent.get(l.student_id) ?? 0) + 1)
    }
    const nameOf = (id: string) => students.find((s) => s.id === id)?.full_name ?? id
    return {
      total: rows.length,
      byInstructor: [...byInstructor.entries()].sort((a, b) => b[1] - a[1]),
      byLevel: [...byLevel.entries()].sort((a, b) => b[1] - a[1]),
      byStudent: [...byStudent.entries()]
        .map(([id, count]) => [nameOf(id), count] as const)
        .sort((a, b) => b[1] - a[1]),
    }
  }, [lessons, students, studentFilter, levelNames])

  // ---- student overview ----
  const studentOverview = useMemo(() => {
    const relevant = visitsInRange.filter((a) => a.student_id && (studentFilter === 'all' || a.student_id === studentFilter))
    const perStudent = new Map<string, { present: number; absent: number }>()
    for (const a of relevant) {
      if (!a.student_id) continue
      const rec = perStudent.get(a.student_id) ?? { present: 0, absent: 0 }
      if (a.kind === 'missed') rec.absent++
      else if (a.kind === 'attended' || a.kind === 'made_up') rec.present++
      perStudent.set(a.student_id, rec)
    }
    const active = students.filter((s) => s.active && (studentFilter === 'all' || s.id === studentFilter))
    const poor: { name: string; pct: number }[] = []
    const normal: string[] = []
    for (const s of active) {
      const rec = perStudent.get(s.id)
      if (!rec) continue
      const total = rec.present + rec.absent
      if (total === 0) continue
      const pct = Math.round((rec.present / total) * 100)
      if (pct < 80) poor.push({ name: s.full_name, pct })
      else normal.push(s.full_name)
    }
    return {
      total: studentFilter === 'all' ? students.length : students.filter(s => s.id === studentFilter).length,
      active: active.length,
      poor: poor.sort((a, b) => a.pct - b.pct),
      normalCount: normal.length,
    }
  }, [students, visitsInRange, studentFilter])

  const selectedAssessments = assessments.filter(a => studentFilter === 'all' || a.student_id === studentFilter)
  const selectedPlans = remediationPlans.filter(p => studentFilter === 'all' || p.student_id === studentFilter)
  const simpleBar = (label: string, count: number, max: number) => (
    <li key={label} className="py-1.5 text-sm">
      <div className="flex justify-between mb-0.5">
        <span className="truncate">{label}</span>
        <span className="text-slate-600 ml-2 shrink-0">{count}</span>
      </div>
      <div className="h-1.5 bg-slate-100 rounded-full">
        <div
          className="h-1.5 bg-[color:var(--rt-primary)] rounded-full"
          style={{ width: max ? `${(count / max) * 100}%` : '0%' }}
        />
      </div>
    </li>
  )

  if (loading) return <LoadingPanel label="Loading reports…" />
  if (error) return <ErrorPanel message={error} onRetry={() => void load(from, to)} />

  const maxInstr = Math.max(1, ...lessonSummary.byInstructor.map(([, c]) => c))
  const maxLevel = Math.max(1, ...lessonSummary.byLevel.map(([, c]) => c))
  const maxStudent = Math.max(1, ...lessonSummary.byStudent.map(([, c]) => c))

  return (
    <div>
      <PageHeader title="Reports" subtitle={`${appliedPeriod.from} → ${appliedPeriod.to}`} accent="yellow" />

      <div className="flex flex-wrap items-end gap-2 mb-6">
        <label className="text-sm">
          <span className="block text-slate-600 mb-1">Period</span>
          <select
            value={range}
            onChange={(e) => setRange(e.target.value as Range)}
            className="p-2 border border-slate-200 rounded-lg text-sm"
          >
            <option value="7">Last 7 days</option>
            <option value="30">Last 30 days</option>
            <option value="90">Last 90 days</option>
            <option value="custom">Custom range</option>
          </select>
        </label>
        {range === 'custom' && (
          <>
            <label className="text-sm">
              <span className="block text-slate-600 mb-1">From</span>
              <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="p-2 border border-slate-200 rounded-lg text-sm" />
            </label>
            <label className="text-sm">
              <span className="block text-slate-600 mb-1">To</span>
              <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="p-2 border border-slate-200 rounded-lg text-sm" />
            </label>
          </>
        )}
        <label className="text-sm">
          <span className="block text-slate-600 mb-1">Student</span>
          <select
            value={studentFilter}
            onChange={(e) => setStudentFilter(e.target.value)}
            className="p-2 border border-slate-200 rounded-lg text-sm max-w-[12rem]"
          >
            <option value="all">All students</option>
            {students.map((s) => (
              <option key={s.id} value={s.id}>{s.full_name}</option>
            ))}
          </select>
        </label>
        <button className="btn-primary text-sm" onClick={applyRange} disabled={range === 'custom' && (!from || !to || from > to)}>
          Apply
        </button>
      </div>

      <h3 className="font-semibold mb-3">Attendance</h3>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard value={attSummary.present} label="Sessions attended" tone="good" />
        <StatCard value={attSummary.absent} label="Outstanding absences" tone={attSummary.absent > 0 ? 'bad' : undefined} />
        <StatCard value={attSummary.pct == null ? '—' : `${attSummary.pct}%`} label="Attendance rate" />
        <StatCard value={attSummary.marks} label="Register marks" />
      </div>

      <h3 className="font-semibold mb-3">Curriculum lessons and assessments completed</h3>
      <div className="grid md:grid-cols-3 gap-6 mb-6">
        <section className="card p-4">
          <div className="font-medium mb-2">By instructor · {lessonSummary.total} total</div>
          {lessonSummary.byInstructor.length === 0 ? (
            <EmptyState title="No lessons in this period" />
          ) : (
            <ul>{lessonSummary.byInstructor.map(([name, c]) => simpleBar(name, c, maxInstr))}</ul>
          )}
        </section>
        <section className="card p-4">
          <div className="font-medium mb-2">By level</div>
          {lessonSummary.byLevel.length === 0 ? (
            <EmptyState title="No lessons in this period" />
          ) : (
            <ul>{lessonSummary.byLevel.map(([name, c]) => simpleBar(name, c, maxLevel))}</ul>
          )}
        </section>
        <section className="card p-4">
          <div className="font-medium mb-2">By student</div>
          {lessonSummary.byStudent.length === 0 ? (
            <EmptyState title="No lessons in this period" />
          ) : (
            <ul>{lessonSummary.byStudent.map(([name, c]) => simpleBar(name, c, maxStudent))}</ul>
          )}
        </section>
      </div>

      <h3 className="font-semibold mb-3">Assessments & remediation</h3>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard value={selectedAssessments.filter((a) => a.passed === true).length} label="Passed" tone="good" />
        <StatCard value={selectedAssessments.filter((a) => a.passed === false).length} label="Failed" tone={selectedAssessments.some((a) => a.passed === false) ? 'warn' : undefined} />
        <StatCard
          value={selectedPlans.filter((p) => p.status === 'required' || p.status === 'in_progress').length}
          label="In remediation"
        />
        <StatCard
          value={selectedPlans.filter((p) => p.status === 'intervention_required').length}
          label="Intervention required"
          tone={selectedPlans.some((p) => p.status === 'intervention_required') ? 'bad' : undefined}
        />
      </div>

      <h3 className="font-semibold mb-3">Student overview</h3>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard value={studentOverview.total} label="Total students" />
        <StatCard value={studentOverview.active} label="Active" />
        <StatCard value={studentOverview.poor.length} label="Poor attendance (<80%)" tone={studentOverview.poor.length ? 'warn' : undefined} />
        <StatCard value={studentOverview.normalCount} label="Progressing normally" tone="good" />
      </div>
      {studentOverview.poor.length > 0 && (
        <section className="card p-4">
          <h4 className="font-medium mb-2">May need a check-in</h4>
          <ul className="text-sm space-y-1">
            {studentOverview.poor.map((p) => (
              <li key={p.name} className="flex justify-between">
                <span>{p.name}</span>
                <span className="text-rose-600">{p.pct}%</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
