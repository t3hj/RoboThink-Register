import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { PageHeader, LoadingPanel, ErrorPanel, EmptyState, SubscriptionBadge } from '../components/ui'
import type { Student } from '../types'

type SortKey = 'name' | 'day' | 'level' | 'progress'

interface Row extends Student {
  next_lesson: number | null
  total_lessons: number | null
}

export default function Students() {
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [dayFilter, setDayFilter] = useState('all')
  const [activeFilter, setActiveFilter] = useState<'all' | 'active' | 'inactive'>('active')
  const [sort, setSort] = useState<SortKey>('name')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const [studentsRes, progressRes] = await Promise.all([
      supabase.from('students').select('*, levels(name), subscriptions(name)').order('full_name'),
      supabase.from('student_progress').select('student_id, next_lesson, total_lessons'),
    ])
    if (studentsRes.error || progressRes.error) {
      setError(studentsRes.error?.message ?? progressRes.error?.message ?? 'Unknown error')
      setLoading(false)
      return
    }
    const progMap = new Map(
      ((progressRes.data ?? []) as { student_id: string; next_lesson: number | null; total_lessons: number | null }[]).map(
        (p) => [p.student_id, p],
      ),
    )
    setRows(
      ((studentsRes.data ?? []) as Student[]).map((s) => ({
        ...s,
        next_lesson: progMap.get(s.id)?.next_lesson ?? null,
        total_lessons: progMap.get(s.id)?.total_lessons ?? null,
      })),
    )
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const days = useMemo(() => [...new Set(rows.map((r) => r.preferred_day).filter(Boolean))] as string[], [rows])

  const visible = useMemo(() => {
    let out = rows
    const q = query.trim().toLowerCase()
    if (q) out = out.filter((r) => r.full_name.toLowerCase().includes(q) || (r.parent_name ?? '').toLowerCase().includes(q))
    if (dayFilter !== 'all') out = out.filter((r) => r.preferred_day === dayFilter)
    if (activeFilter !== 'all') out = out.filter((r) => (activeFilter === 'active' ? r.active : !r.active))
    const sorted = [...out]
    sorted.sort((a, b) => {
      switch (sort) {
        case 'day':
          return ((a.preferred_day ?? '') + (a.preferred_time ?? '')).localeCompare((b.preferred_day ?? '') + (b.preferred_time ?? ''))
        case 'level':
          return (a.current_level_id ?? 99) - (b.current_level_id ?? 99)
        case 'progress': {
          const ap = a.total_lessons ? (a.next_lesson ?? 0) / a.total_lessons : 0
          const bp = b.total_lessons ? (b.next_lesson ?? 0) / b.total_lessons : 0
          return ap - bp
        }
        default:
          return a.full_name.localeCompare(b.full_name)
      }
    })
    return sorted
  }, [rows, query, dayFilter, activeFilter, sort])


  if (loading) return <LoadingPanel label="Loading students…" />
  if (error) return <ErrorPanel message={error} onRetry={() => void load()} />

  return (
    <div>
      <PageHeader title="Students" subtitle={`${visible.length} of ${rows.length} shown`} />

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <input
          type="search"
          placeholder="Search name or parent…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="flex-1 min-w-[12rem] p-2 border border-slate-200 rounded-lg text-sm"
        />
        <select
          value={dayFilter}
          onChange={(e) => setDayFilter(e.target.value)}
          className="p-2 border border-slate-200 rounded-lg text-sm"
          aria-label="Filter by day"
        >
          <option value="all">All days</option>
          {days.map((d) => (
            <option key={d} value={d}>{d}</option>
          ))}
        </select>
        <select
          value={activeFilter}
          onChange={(e) => setActiveFilter(e.target.value as typeof activeFilter)}
          className="p-2 border border-slate-200 rounded-lg text-sm"
          aria-label="Filter by status"
        >
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
          <option value="all">All</option>
        </select>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as SortKey)}
          className="p-2 border border-slate-200 rounded-lg text-sm"
          aria-label="Sort"
        >
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
          {visible.map((s) => (
            <Link key={s.id} to={`/students/${s.id}`} className="card p-4 hover:shadow-md transition-shadow flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2">
                <div className="font-medium truncate">{s.full_name}</div>
                <span className={`badge ${s.active ? 'badge-arrived' : 'badge-absent'}`}>{s.active ? 'Active' : 'Inactive'}</span>
              </div>
              <div className="text-sm text-slate-500">
                {s.levels?.name ?? `Level ${s.current_level_id ?? '—'}`} · Lesson {s.next_lesson ?? '—'}
                {s.total_lessons ? ` of ${s.total_lessons}` : ''}
              </div>
              <div className="text-sm text-slate-500">{s.preferred_day ?? '—'} · {s.preferred_time ?? '—'}</div>
              <div className="mt-auto flex items-center justify-between">
                <SubscriptionBadge subscriptionId={s.subscription_id} />
                <span className="text-xs text-slate-400">{s.parent_name}</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
