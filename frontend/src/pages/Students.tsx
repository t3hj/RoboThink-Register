import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../lib/auth'
import { PageHeader, LoadingPanel, ErrorPanel, EmptyState, SubscriptionBadge } from '../components/ui'
import StudentForm from '../components/StudentForm'
import { levelLabel, parseLevelName } from '../lib/curriculum'
import type { Student, StudentProgress } from '../types'

type SortKey = 'name' | 'day' | 'level' | 'progress'

interface Row extends Student {
  progress: StudentProgress | null
}

export default function Students() {
  const { role } = useAuth()
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [dayFilter, setDayFilter] = useState('all')
  const [programmeFilter, setProgrammeFilter] = useState('all')
  const [activeFilter, setActiveFilter] = useState<'all' | 'active' | 'inactive'>('active')
  const [sort, setSort] = useState<SortKey>('name')
  const [showForm, setShowForm] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const [studentsRes, progressRes] = await Promise.all([
      supabase.from('students').select('*, levels(name), subscriptions(name)').order('full_name'),
      supabase.from('student_progress').select('*'),
    ])
    if (studentsRes.error || progressRes.error) {
      setError(studentsRes.error?.message ?? progressRes.error?.message ?? 'Unknown error')
      setLoading(false)
      return
    }
    const progMap = new Map(((progressRes.data ?? []) as StudentProgress[]).map((p) => [p.student_id, p]))
    setRows(((studentsRes.data ?? []) as Student[]).map((s) => ({ ...s, progress: progMap.get(s.id) ?? null })))
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const days = useMemo(() => [...new Set(rows.map((r) => r.preferred_day).filter(Boolean))] as string[], [rows])
  const programmes = useMemo(() => {
    const names = rows.map((r) => parseLevelName(r.progress?.level_name ?? r.levels?.name ?? '').programme).filter(Boolean)
    return [...new Set(names)]
  }, [rows])

  const visible = useMemo(() => {
    let out = rows
    const q = query.trim().toLowerCase()
    if (q) out = out.filter((r) => r.full_name.toLowerCase().includes(q) || (r.parent_name ?? '').toLowerCase().includes(q))
    if (dayFilter !== 'all') out = out.filter((r) => r.preferred_day === dayFilter)
    if (programmeFilter !== 'all')
      out = out.filter((r) => parseLevelName(r.progress?.level_name ?? r.levels?.name ?? '').programme === programmeFilter)
    if (activeFilter !== 'all') out = out.filter((r) => (activeFilter === 'active' ? r.active : !r.active))
    const sorted = [...out]
    sorted.sort((a, b) => {
      switch (sort) {
        case 'day':
          return ((a.preferred_day ?? '') + (a.preferred_time ?? '')).localeCompare((b.preferred_day ?? '') + (b.preferred_time ?? ''))
        case 'level':
          return (a.current_level_id ?? 99) - (b.current_level_id ?? 99)
        case 'progress': {
          const ap = a.progress?.total_lessons ? (a.progress.current_lesson_number ?? 0) / a.progress.total_lessons : 0
          const bp = b.progress?.total_lessons ? (b.progress.current_lesson_number ?? 0) / b.progress.total_lessons : 0
          return ap - bp
        }
        default:
          return a.full_name.localeCompare(b.full_name)
      }
    })
    return sorted
  }, [rows, query, dayFilter, programmeFilter, activeFilter, sort])

  if (loading) return <LoadingPanel label="Loading students…" />
  if (error) return <ErrorPanel message={error} onRetry={() => void load()} />

  return (
    <div>
      <PageHeader
        title="Students"
        subtitle={`${visible.length} of ${rows.length} shown`}
        accent="green"
        actions={
          role === 'admin' ? (
            <button className="btn-primary" onClick={() => setShowForm(true)}>
              + Add student
            </button>
          ) : undefined
        }
      />

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <input
          type="search"
          placeholder="Search name or parent…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="flex-1 min-w-[12rem] p-2 border border-slate-200 rounded-lg text-sm"
        />
        <select value={dayFilter} onChange={(e) => setDayFilter(e.target.value)} className="p-2 border border-slate-200 rounded-lg text-sm" aria-label="Filter by day">
          <option value="all">All days</option>
          {days.map((d) => (
            <option key={d} value={d}>{d}</option>
          ))}
        </select>
        <select value={programmeFilter} onChange={(e) => setProgrammeFilter(e.target.value)} className="p-2 border border-slate-200 rounded-lg text-sm" aria-label="Filter by programme">
          <option value="all">All programmes</option>
          {programmes.map((p) => (
            <option key={p} value={p}>{p}</option>
          ))}
        </select>
        <select value={activeFilter} onChange={(e) => setActiveFilter(e.target.value as typeof activeFilter)} className="p-2 border border-slate-200 rounded-lg text-sm" aria-label="Filter by status">
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
          <option value="all">All</option>
        </select>
        <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} className="p-2 border border-slate-200 rounded-lg text-sm" aria-label="Sort">
          <option value="name">Sort: Name</option>
          <option value="day">Sort: Day &amp; time</option>
          <option value="level">Sort: Level</option>
          <option value="progress">Sort: Progress</option>
        </select>
      </div>

      {visible.length === 0 ? (
        <EmptyState title="No students match" hint="Try clearing the search or filters." />
      ) : (
        <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {visible.map((s) => {
            const pct =
              s.progress?.total_lessons && s.progress.current_lesson_number != null
                ? Math.round((s.progress.current_lesson_number / s.progress.total_lessons) * 100)
                : null
            return (
              <Link key={s.id} to={`/students/${s.id}`} className="card p-4 hover:shadow-md transition-shadow flex flex-col gap-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="font-medium truncate">{s.full_name}</div>
                  <span className={`badge ${s.active ? 'badge-arrived' : 'badge-absent'}`}>{s.active ? 'Active' : 'Inactive'}</span>
                </div>
                <div className="text-sm text-slate-500">
                  {s.progress ? levelLabel({ name: s.progress.level_name ?? '' }) : s.levels?.name ?? '—'}
                  {s.progress?.current_lesson_number != null ? ` · Lesson ${s.progress.current_lesson_number}` : ''}
                  {s.progress?.total_lessons ? ` of ${s.progress.total_lessons}` : ''}
                </div>
                {pct != null && (
                  <div className="progress-track" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={`${s.full_name} curriculum progress`}>
                    <div className="progress-fill" style={{ width: `${pct}%` }} />
                  </div>
                )}
                <div className="text-sm text-slate-500">{s.preferred_day ?? '—'} · {s.preferred_time ?? '—'}</div>
                <div className="mt-auto flex items-center justify-between">
                  <SubscriptionBadge subscriptionId={s.subscription_id} />
                  <span className="text-xs text-slate-400">{s.parent_name}</span>
                </div>
              </Link>
            )
          })}
        </div>
      )}

      {showForm && (
        <StudentForm
          onClose={() => setShowForm(false)}
          onSaved={() => {
            setShowForm(false)
            void load()
          }}
        />
      )}
    </div>
  )
}
