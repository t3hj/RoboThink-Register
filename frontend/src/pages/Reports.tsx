import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { PageHeader, LoadingPanel, ErrorPanel, EmptyState, StatCard } from '../components/ui'
import { addDays, todayISO } from '../lib/dates'
import type { Attendance, LessonRecord, Student } from '../types'

type Range = '7' | '30' | '90' | 'custom'

export default function Reports() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [range, setRange] = useState<Range>('30')
  const [from, setFrom] = useState(addDays(todayISO(), -30))
  const [to, setTo] = useState(todayISO())
  const [studentFilter, setStudentFilter] = useState('all')

  const [attendance, setAttendance] = useState<Attendance[]>([])
  const [lessons, setLessons] = useState<LessonRecord[]>([])
  const [students, setStudents] = useState<Student[]>([])

  const load = useCallback(async (fromDate: string, toDate: string) => {
    setLoading(true)
    setError(null)
    const [aRes, lRes, sRes] = await Promise.all([
      supabase.from('attendance').select('*').gte('date', fromDate).lte('date', toDate),
      supabase
        .from('lesson_records')
        .select('*, profiles(name), levels(name)')
        .eq('status', 'completed')
        .gte('date', fromDate)
        .lte('date', toDate),
      supabase.from('students').select('*').order('full_name'),
    ])
    if (aRes.error || lRes.error || sRes.error) {
      setError(aRes.error?.message ?? lRes.error?.message ?? sRes.error?.message ?? 'Unknown error')
      setLoading(false)
      return
    }
    setAttendance((aRes.data ?? []) as Attendance[])
    setLessons((lRes.data ?? []) as LessonRecord[])
    setStudents((sRes.data ?? []) as Student[])
    setLoading(false)
  }, [])

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
    const arrived = rows.filter((a) => a.status === 'Arrived').length
    const completed = rows.filter((a) => a.status === 'Completed').length
    const absent = rows.filter((a) => a.status === 'Absent').length
    const present = arrived + completed
    const pct = present + absent > 0 ? Math.round((present / (present + absent)) * 100) : null
    return { arrived, completed, absent, pct }
  }, [attendance, studentFilter])

  // ---- lesson progress ----
  const lessonSummary = useMemo(() => {
    const rows = studentFilter === 'all' ? lessons : lessons.filter((l) => l.student_id === studentFilter)
    const byInstructor = new Map<string, number>()
    const byLevel = new Map<string, number>()
    const byStudent = new Map<string, number>()
    for (const l of rows) {
      const instructor = l.profiles?.name ?? 'Unassigned'
      byInstructor.set(instructor, (byInstructor.get(instructor) ?? 0) + 1)
      const level = l.levels?.name ?? `Level ${l.level_id}`
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
  }, [lessons, students, studentFilter])

  // ---- student overview ----
  const studentOverview = useMemo(() => {
    const relevant = attendance.filter((a) => a.student_id && (studentFilter === 'all' || a.student_id === studentFilter))
    const perStudent = new Map<string, { present: number; absent: number }>()
    for (const a of relevant) {
      const rec = perStudent.get(a.student_id) ?? { present: 0, absent: 0 }
      if (a.status === 'Absent') rec.absent++
      else if (a.status === 'Arrived' || a.status === 'Completed') rec.present++
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
      total: students.length,
      active: active.length,
      poor: poor.sort((a, b) => a.pct - b.pct),
      normalCount: normal.length,
    }
  }, [students, attendance, studentFilter])

  const simpleBar = (label: string, count: number, max: number) => (
    <li key={label} className="py-1.5 text-sm">
      <div className="flex justify-between mb-0.5">
        <span className="truncate">{label}</span>
        <span className="text-slate-500 ml-2 shrink-0">{count}</span>
      </div>
      <div className="h-1.5 bg-slate-100 rounded-full">
        <div
          className="h-1.5 bg-[color:var(--rt-teal)] rounded-full"
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
      <PageHeader title="Reports" subtitle={`${from} → ${to}`} />

      <div className="flex flex-wrap items-end gap-2 mb-6">
        <label className="text-sm">
          <span className="block text-slate-500 mb-1">Period</span>
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
              <span className="block text-slate-500 mb-1">From</span>
              <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="p-2 border border-slate-200 rounded-lg text-sm" />
            </label>
            <label className="text-sm">
              <span className="block text-slate-500 mb-1">To</span>
              <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="p-2 border border-slate-200 rounded-lg text-sm" />
            </label>
          </>
        )}
        <label className="text-sm">
          <span className="block text-slate-500 mb-1">Student</span>
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
        <button className="btn-primary text-sm" onClick={applyRange}>
          Apply
        </button>
      </div>

      <h3 className="font-semibold mb-3">Attendance</h3>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard value={attSummary.arrived + attSummary.completed} label="Present" tone="good" />
        <StatCard value={attSummary.absent} label="Absent" tone={attSummary.absent > 0 ? 'bad' : undefined} />
        <StatCard value={attSummary.pct == null ? '—' : `${attSummary.pct}%`} label="Attendance rate" />
        <StatCard value={attendance.length} label="Register marks" />
      </div>

      <h3 className="font-semibold mb-3">Lesson progress</h3>
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
