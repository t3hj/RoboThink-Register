import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../lib/auth'
import { useToast } from '../components/Toast'
import { PageHeader, StatCard, LoadingPanel, ErrorPanel, EmptyState } from '../components/ui'
import { todayISO, dayName, addDays, formatShortDate } from '../lib/dates'
import { attendancePercentage, attendanceFlag } from '../lib/attendanceStats'
import type { Attendance, Student, TermTimeFollowup, TermTimeFollowupStatus } from '../types'

const FOLLOWUP_OPTIONS: { value: TermTimeFollowupStatus; label: string }[] = [
  { value: 'needs_follow_up', label: 'Needs follow-up' },
  { value: 'contacted', label: 'Contacted' },
  { value: 'extended', label: 'Extended' },
  { value: 'not_continuing', label: 'Not continuing' },
  { value: 'snoozed', label: 'Snoozed / follow up later' },
]

function rangeStats(rows: Attendance[], expected: number) {
  const attended = rows.filter((a) => a.status === 'Arrived' || a.status === 'Completed').length
  const missed = rows.filter((a) => a.status === 'Absent').length
  const catchUp = rows.filter((a) => a.session_type === 'catch_up').length
  return { expected, attended, missed, catchUp, pct: attendancePercentage(rows) }
}

function expectedSessionsInRange(students: Student[], from: string, to: string): number {
  let n = 0
  let d = from
  while (d <= to) {
    const dow = dayName(d)
    n += students.filter((s) => s.preferred_day === dow).length
    d = addDays(d, 1)
  }
  return n
}

export default function ManagementDashboard() {
  const { role } = useAuth()
  const { notify } = useToast()
  const today = todayISO()
  const weekStart = addDays(today, -6)
  const prevWeekStart = addDays(today, -13)
  const prevWeekEnd = addDays(today, -7)
  const monthStart = addDays(today, -29)
  const prevMonthStart = addDays(today, -59)
  const prevMonthEnd = addDays(today, -30)

  const [students, setStudents] = useState<Student[]>([])
  const [todayAtt, setTodayAtt] = useState<Attendance[]>([])
  const [weekAtt, setWeekAtt] = useState<Attendance[]>([])
  const [prevWeekAtt, setPrevWeekAtt] = useState<Attendance[]>([])
  const [monthAtt, setMonthAtt] = useState<Attendance[]>([])
  const [prevMonthAtt, setPrevMonthAtt] = useState<Attendance[]>([])
  const [allAtt, setAllAtt] = useState<Attendance[]>([])
  const [followups, setFollowups] = useState<TermTimeFollowup[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const [sRes, taRes, waRes, pwRes, maRes, pmRes, allRes, ftRes] = await Promise.all([
      supabase.from('students').select('*'),
      supabase.from('attendance').select('*').eq('date', today),
      supabase.from('attendance').select('*').gte('date', weekStart).lte('date', today),
      supabase.from('attendance').select('*').gte('date', prevWeekStart).lte('date', prevWeekEnd),
      supabase.from('attendance').select('*').gte('date', monthStart).lte('date', today),
      supabase.from('attendance').select('*').gte('date', prevMonthStart).lte('date', prevMonthEnd),
      // Used for "long absence" detection — most recent attendance per student.
      supabase.from('attendance').select('*').order('date', { ascending: false }).limit(2000),
      supabase.from('term_time_followups').select('*, students(full_name)').order('created_at', { ascending: false }),
    ])
    if (sRes.error || taRes.error || waRes.error || pwRes.error || maRes.error || pmRes.error || allRes.error || ftRes.error) {
      setError(
        sRes.error?.message ??
          taRes.error?.message ??
          waRes.error?.message ??
          pwRes.error?.message ??
          maRes.error?.message ??
          pmRes.error?.message ??
          allRes.error?.message ??
          ftRes.error?.message ??
          'Unknown error',
      )
      setLoading(false)
      return
    }
    setStudents((sRes.data ?? []) as Student[])
    setTodayAtt((taRes.data ?? []) as Attendance[])
    setWeekAtt((waRes.data ?? []) as Attendance[])
    setPrevWeekAtt((pwRes.data ?? []) as Attendance[])
    setMonthAtt((maRes.data ?? []) as Attendance[])
    setPrevMonthAtt((pmRes.data ?? []) as Attendance[])
    setAllAtt((allRes.data ?? []) as Attendance[])
    setFollowups((ftRes.data ?? []) as TermTimeFollowup[])
    setLoading(false)
  }, [today, weekStart, prevWeekStart, prevWeekEnd, monthStart, prevMonthStart, prevMonthEnd])

  useEffect(() => {
    void load()
  }, [load])

  async function setFollowupStatus(id: string, status: TermTimeFollowupStatus) {
    const { error: err } = await supabase.from('term_time_followups').update({ status }).eq('id', id)
    if (err) {
      notify(err.message, 'error')
      return
    }
    notify('Follow-up status updated', 'success')
    void load()
  }

  const active = useMemo(() => students.filter((s) => s.active), [students])

  const todayStats = useMemo(() => {
    const dow = dayName(today)
    const expected = active.filter((s) => s.preferred_day === dow)
    const attMap = new Map(todayAtt.map((a) => [a.student_id, a]))
    const notArrived = expected.filter((s) => (attMap.get(s.id)?.status ?? 'Not Arrived') === 'Not Arrived').length
    const attended = todayAtt.filter((a) => a.status === 'Arrived' || a.status === 'Completed').length
    const absent = todayAtt.filter((a) => a.status === 'Absent').length
    const catchUp = todayAtt.filter((a) => a.session_type === 'catch_up').length
    const special = todayAtt.filter((a) => a.session_type === 'special').length
    const newToday = active.filter((s) => s.date_joined === today)
    return {
      expected: expected.length,
      attended,
      notArrived,
      absent,
      pct: attended + absent ? Math.round((attended / (attended + absent)) * 100) : null,
      catchUp,
      special,
      newToday,
    }
  }, [active, todayAtt, today])

  const week = useMemo(() => rangeStats(weekAtt, expectedSessionsInRange(active, weekStart, today)), [weekAtt, active, weekStart, today])
  const prevWeek = useMemo(
    () => rangeStats(prevWeekAtt, expectedSessionsInRange(active, prevWeekStart, prevWeekEnd)),
    [prevWeekAtt, active, prevWeekStart, prevWeekEnd],
  )
  const month = useMemo(() => rangeStats(monthAtt, expectedSessionsInRange(active, monthStart, today)), [monthAtt, active, monthStart, today])
  const prevMonth = useMemo(
    () => rangeStats(prevMonthAtt, expectedSessionsInRange(active, prevMonthStart, prevMonthEnd)),
    [prevMonthAtt, active, prevMonthStart, prevMonthEnd],
  )
  const newThisMonth = useMemo(() => active.filter((s) => s.date_joined && s.date_joined >= monthStart).length, [active, monthStart])
  const newLastMonth = useMemo(
    () => active.filter((s) => s.date_joined && s.date_joined >= prevMonthStart && s.date_joined < monthStart).length,
    [active, prevMonthStart, monthStart],
  )

  const movement = useMemo(() => {
    const byStudent = new Map<string, Attendance[]>()
    for (const a of allAtt) byStudent.set(a.student_id, [...(byStudent.get(a.student_id) ?? []), a])
    const declining: Student[] = []
    const longAbsent: Student[] = []
    for (const s of active) {
      const rows = byStudent.get(s.id) ?? []
      const flag = attendanceFlag({ rows, today, hasSchedule: Boolean(s.preferred_day) })
      if (flag === 'several_recent_missed') declining.push(s)
      else if (flag === 'no_attendance_recently') longAbsent.push(s)
    }
    const newStudents = active.filter((s) => s.date_joined && s.date_joined >= addDays(today, -30))
    return { declining, longAbsent, newStudents }
  }, [allAtt, active, today])

  const outstandingFollowups = followups.filter((f) => f.status === 'needs_follow_up')

  if (loading) return <LoadingPanel label="Loading management dashboard…" />
  if (error) return <ErrorPanel message={error} onRetry={() => void load()} />

  const delta = (cur: number | null, prev: number | null) => {
    if (cur == null || prev == null) return ''
    const d = cur - prev
    if (d === 0) return '(no change)'
    return d > 0 ? `(+${d} vs last)` : `(${d} vs last)`
  }

  return (
    <div>
      <PageHeader title="Management dashboard" subtitle="Read-only operational overview" accent="blue" />

      <h2 className="text-lg font-semibold mb-3">Today</h2>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard value={todayStats.expected} label="Expected today" />
        <StatCard value={todayStats.attended} label="Attended" tone="good" />
        <StatCard value={todayStats.notArrived} label="Not arrived" />
        <StatCard value={todayStats.absent} label="Absent" tone={todayStats.absent > 0 ? 'bad' : undefined} />
        <StatCard value={todayStats.pct == null ? '—' : `${todayStats.pct}%`} label="Attendance %" />
        <StatCard value={todayStats.catchUp + todayStats.special} label="Catch-up/special today" />
        <StatCard value={todayStats.newToday.length} label="New students today" />
      </div>
      {todayStats.newToday.length > 0 && (
        <p className="text-sm text-slate-500 -mt-4 mb-6">
          First time today: {todayStats.newToday.map((s) => s.full_name).join(', ')}
        </p>
      )}

      <div className="grid md:grid-cols-2 gap-6 mb-6">
        <section className="card p-4">
          <h3 className="font-semibold mb-3">This week</h3>
          <dl className="text-sm space-y-1.5">
            <div className="flex justify-between"><dt className="text-slate-500">Expected sessions</dt><dd className="font-medium">{week.expected} {delta(week.expected, prevWeek.expected)}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-500">Attended</dt><dd className="font-medium">{week.attended} {delta(week.attended, prevWeek.attended)}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-500">Missed</dt><dd className="font-medium">{week.missed} {delta(week.missed, prevWeek.missed)}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-500">Attendance %</dt><dd className="font-medium">{week.pct == null ? '—' : `${week.pct}%`} {delta(week.pct, prevWeek.pct)}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-500">Catch-up sessions</dt><dd className="font-medium">{week.catchUp} {delta(week.catchUp, prevWeek.catchUp)}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-500">Active students</dt><dd className="font-medium">{active.length}</dd></div>
          </dl>
        </section>

        <section className="card p-4">
          <h3 className="font-semibold mb-3">This month</h3>
          <dl className="text-sm space-y-1.5">
            <div className="flex justify-between"><dt className="text-slate-500">Total sessions</dt><dd className="font-medium">{month.attended + month.missed} {delta(month.attended + month.missed, prevMonth.attended + prevMonth.missed)}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-500">Attendance %</dt><dd className="font-medium">{month.pct == null ? '—' : `${month.pct}%`} {delta(month.pct, prevMonth.pct)}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-500">Missed</dt><dd className="font-medium">{month.missed} {delta(month.missed, prevMonth.missed)}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-500">Catch-up/special</dt><dd className="font-medium">{month.catchUp} {delta(month.catchUp, prevMonth.catchUp)}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-500">New students</dt><dd className="font-medium">{newThisMonth} {delta(newThisMonth, newLastMonth)}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-500">Appear to have stopped attending</dt><dd className="font-medium">{movement.longAbsent.length}</dd></div>
          </dl>
        </section>
      </div>

      <div className="grid md:grid-cols-2 gap-6 mb-6">
        <section className="card p-4">
          <h3 className="font-semibold mb-3">Student movement</h3>
          <div className="text-xs uppercase text-slate-400 mb-1">New (last 30 days) — {movement.newStudents.length}</div>
          {movement.newStudents.length === 0 ? (
            <p className="text-sm text-slate-400 mb-3">None</p>
          ) : (
            <ul className="text-sm mb-3">
              {movement.newStudents.slice(0, 8).map((s) => (
                <li key={s.id}><Link to={`/students/${s.id}`} className="hover:underline">{s.full_name}</Link> <span className="text-slate-400">· joined {s.date_joined && formatShortDate(s.date_joined)}</span></li>
              ))}
            </ul>
          )}
          <div className="text-xs uppercase text-slate-400 mb-1">Declining attendance — {movement.declining.length}</div>
          {movement.declining.length === 0 ? (
            <p className="text-sm text-slate-400 mb-3">None</p>
          ) : (
            <ul className="text-sm mb-3">
              {movement.declining.slice(0, 8).map((s) => (
                <li key={s.id}><Link to={`/students/${s.id}`} className="hover:underline">{s.full_name}</Link></li>
              ))}
            </ul>
          )}
          <div className="text-xs uppercase text-slate-400 mb-1">May have stopped attending — {movement.longAbsent.length}</div>
          {movement.longAbsent.length === 0 ? (
            <p className="text-sm text-slate-400">None</p>
          ) : (
            <ul className="text-sm">
              {movement.longAbsent.slice(0, 8).map((s) => (
                <li key={s.id}><Link to={`/students/${s.id}`} className="hover:underline">{s.full_name}</Link></li>
              ))}
            </ul>
          )}
        </section>

        <section className="card card-accent-top p-4" style={{ ['--accent-color' as string]: 'var(--rt-yellow)' }}>
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold">Term Time follow-ups</h3>
            <span className="badge badge-assess">{outstandingFollowups.length} outstanding</span>
          </div>
          {followups.length === 0 ? (
            <EmptyState title="No Term Time follow-ups yet" hint="Created automatically when a Term Time student completes a 12-lesson block." />
          ) : (
            <ul className="divide-y divide-slate-100">
              {followups.slice(0, 12).map((f) => (
                <li key={f.id} className="py-2 text-sm">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div>
                      <Link to={`/students/${f.student_id}`} className="font-medium hover:underline">{f.students?.full_name ?? 'Student'}</Link>
                      <span className="text-slate-500"> · {f.lessons_completed_in_block} lessons completed</span>
                    </div>
                    {role === 'admin' ? (
                      <select
                        className="p-1 border border-slate-200 rounded text-xs"
                        value={f.status}
                        onChange={(e) => void setFollowupStatus(f.id, e.target.value as TermTimeFollowupStatus)}
                        aria-label={`Follow-up status for ${f.students?.full_name ?? 'student'}`}
                      >
                        {FOLLOWUP_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                      </select>
                    ) : (
                      <span className="badge">{FOLLOWUP_OPTIONS.find((o) => o.value === f.status)?.label}</span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  )
}
