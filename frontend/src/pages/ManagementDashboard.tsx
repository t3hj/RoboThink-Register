import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../lib/auth'
import { useBrand } from '../lib/brand'
import { useCentres } from '../lib/centres'
import { useToast } from '../components/Toast'
import { PageHeader, StatCard, LoadingPanel, ErrorPanel, EmptyState } from '../components/ui'
import { todayISO, addDays, formatShortDate, formatTime12h } from '../lib/dates'
import { fetchAllRows } from '../lib/pagination'
import { attendancePercentage, weeklySlots } from '../lib/attendanceStats'
import {
  managementAnalytics,
  mondayOf,
  type ManagementAttendanceRow,
  type ManagementData,
  type TermTimeEntry,
} from '../lib/managementAnalytics'
import TermTimeFollowupsPanel, { type FollowupUpdate } from '../components/TermTimeFollowupsPanel'
import {
  AttendanceTrendChart,
  CentreAttendanceChart,
  StudentRetentionChart,
  lastTwelveWeekStarts,
  studentRetentionCohorts,
  weeklyAttendancePoints,
} from '../components/AnalyticsCharts'
import type { Attendance, AttendedSession, FeedbackSheet, Student, TermTimeFollowup } from '../types'

type Tab = 'attended' | 'missed' | 'catchups' | 'unmarked'
const TABS: { id: Tab; label: string }[] = [
  { id: 'attended', label: 'Attended' },
  { id: 'missed', label: 'Missed classes' },
  { id: 'catchups', label: 'Catch-ups' },
  { id: 'unmarked', label: 'Unmarked registers' },
]
const isAttended = (row: ManagementAttendanceRow) => row.kind === 'attended' || row.kind === 'extra'

export default function ManagementDashboard() {
  const { role, profile } = useAuth()
  const { activeBrand } = useBrand()
  const {
    centres,
    selectedCentreId,
    selectedCentre,
    isAllCentres,
    loading: centresLoading,
    error: centresError,
    refresh,
  } = useCentres()
  const { notify } = useToast()
  const today = todayISO()
  const [from, setFrom] = useState(mondayOf(today))
  const [to, setTo] = useState(addDays(mondayOf(today), 6))
  const [tab, setTab] = useState<Tab>('attended')
  const [search, setSearch] = useState('')
  const [data, setData] = useState<ManagementData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [loadedScope, setLoadedScope] = useState('')
  const scope = JSON.stringify([activeBrand, selectedCentreId, isAllCentres, centresLoading, centresError])
  const activeScope = useRef(scope)
  activeScope.current = scope
  const requestId = useRef(0)

  const load = useCallback(async () => {
    if (centresLoading || centresError || (!selectedCentreId && !isAllCentres)) return
    const requestedScope = JSON.stringify([activeBrand, selectedCentreId, isAllCentres, centresLoading, centresError])
    const request = ++requestId.current
    const isCurrent = () => request === requestId.current && activeScope.current === requestedScope
    setLoading(true)
    setError(null)
    try {
      const studentsRes = await fetchAllRows(() => {
        let query = supabase
          .from('students')
          .select('*, subscriptions(name), student_schedules(day_of_week,start_time,active)')
          .eq('brand', activeBrand)
          .order('id')
        if (selectedCentreId) query = query.eq('centre_id', selectedCentreId)
        return query
      })
      if (!isCurrent()) return
      if (studentsRes.error) throw studentsRes.error
      const students = (studentsRes.data ?? []) as Student[]
      const ids = students.map((student) => student.id)
      // Keep every page and batch the ID filters so a large centre does not
      // silently lose history or exceed URL limits. Empty centres issue no reads.
      async function readRows<T>(table: string) {
        const result: T[] = []
        for (let offset = 0; offset < ids.length; offset += 100) {
          const batch = ids.slice(offset, offset + 100)
          const response = await fetchAllRows(() =>
            supabase.from(table).select('*').in('student_id', batch).order('id'),
          )
          if (response.error) throw response.error
          result.push(...((response.data ?? []) as T[]))
        }
        return result
      }
      const [attendance, sessions, followups, feedback] = await Promise.all([
        readRows<Attendance>('attendance'),
        readRows<AttendedSession>('attended_sessions'),
        readRows<TermTimeFollowup>('term_time_followups'),
        readRows<FeedbackSheet>('feedback_sheets'),
      ])
      if (!isCurrent()) return
      setData({ students, attendance, sessions, followups, feedback })
      setLoadedScope(requestedScope)
    } catch (failure) {
      if (!isCurrent()) return
      setError(
        failure && typeof failure === 'object' && 'message' in failure
          ? String(failure.message)
          : 'Unable to load management dashboard',
      )
      setLoadedScope(requestedScope)
    } finally {
      if (isCurrent()) setLoading(false)
    }
  }, [activeBrand, selectedCentreId, isAllCentres, centresLoading, centresError])

  useEffect(() => {
    void load()
    return () => {
      requestId.current++
    }
  }, [load])
  const validRange = Boolean(from && to && from <= to && to <= addDays(from, 365))
  const stats = useMemo(
    () => (data && validRange ? managementAnalytics(data, from, to, today) : null),
    [data, from, to, today, validRange],
  )
  const weekStarts = useMemo(() => lastTwelveWeekStarts(today), [today])
  const weekPoints = useMemo(
    () =>
      stats
        ? weeklyAttendancePoints(
            stats.rows.map((row) => ({ ...row, student_id: row.student.id })),
            weekStarts,
          )
        : [],
    [stats, weekStarts],
  )

  async function saveFollowup(entry: TermTimeEntry, update: FollowupUpdate): Promise<boolean> {
    if (!profile || !['admin', 'management'].includes(role ?? '')) return false
    const requestedScope = activeScope.current
    const { data: saved, error: failure } = await supabase
      .from('term_time_followups')
      .upsert(
        {
          student_id: entry.student.id,
          session_block: entry.block,
          ...update,
          updated_by: profile.id,
        },
        { onConflict: 'student_id,session_block' },
      )
      .select('*')
      .maybeSingle()
    if (activeScope.current !== requestedScope) return false
    if (failure || !saved) {
      notify(failure?.message ?? 'Follow-up was not saved. Refresh and try again.', 'error')
      return false
    }
    setData((current) =>
      current
        ? {
            ...current,
            followups: [
              ...current.followups.filter(
                (row) =>
                  row.id !== saved.id && !(row.student_id === entry.student.id && row.session_block === entry.block),
              ),
              saved as TermTimeFollowup,
            ],
          }
        : current,
    )
    notify('Follow-up saved', 'success')
    return true
  }

  if (centresLoading) return <LoadingPanel label="Loading working centre…" />
  if (centresError) return <ErrorPanel message={centresError} onRetry={() => void refresh()} />
  if (!selectedCentreId && !isAllCentres)
    return (
      <EmptyState
        title="No working centre available"
        hint="Please contact an administrator to check your centre assignment."
      />
    )
  if (loading || loadedScope !== scope) return <LoadingPanel label="Loading management dashboard…" />
  if (error) return <ErrorPanel message={error} onRetry={() => void load()} />
  if (!data) return null
  const studentById = new Map(data.students.map((student) => [student.id, student]))
  const activeStudents = data.students.filter((student) => student.active)
  const newStudents = activeStudents.filter(
    (student) =>
      student.date_joined && student.date_joined >= `${today.slice(0, 7)}-01` && student.date_joined <= today,
  )
  const scheduleGroups = new Map<string, { day: string; time: string | null; students: Set<string> }>()
  for (const student of activeStudents) {
    for (const slot of weeklySlots(student)) {
      const key = `${slot.day}|${slot.time ?? ''}`
      const group = scheduleGroups.get(key) ?? { ...slot, students: new Set<string>() }
      group.students.add(student.id)
      scheduleGroups.set(key, group)
    }
  }
  const dayOrder = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
  const schedules = [...scheduleGroups.values()].sort(
    (a, b) => dayOrder.indexOf(a.day) - dayOrder.indexOf(b.day) || (a.time ?? '').localeCompare(b.time ?? ''),
  )
  const centreName = (student: Student) =>
    centres.find((centre) => centre.id === student.centre_id)?.name ?? student.centres?.name ?? 'Centre not set'
  const matches = (student: Student) => student.full_name.toLowerCase().includes(search.trim().toLowerCase())
  const rows = stats
    ? tab === 'attended'
      ? stats.attended
      : tab === 'missed'
        ? stats.missed
        : tab === 'catchups'
          ? stats.catchUps
          : []
    : []
  function selectRange(start: string, end: string) {
    setFrom(start)
    setTo(end)
  }
  const tabCounts = stats
    ? {
        attended: stats.attended.length,
        missed: stats.missed.length,
        catchups: stats.catchUps.length,
        unmarked: stats.unmarked.length,
      }
    : null
  const centrePoints = stats
    ? centres.map((centre) => {
        const rows = stats.rows.filter((row) => row.student.centre_id === centre.id && row.date >= weekStarts[0])
        return {
          id: centre.id,
          name: centre.name,
          attended: rows.filter(isAttended).length,
          missed: rows.filter((row) => row.kind === 'missed').length,
          rate: attendancePercentage(rows.map((row) => ({ ...row, student_id: row.student.id }))),
        }
      })
    : []

  return (
    <div>
      <PageHeader
        title="Management dashboard"
        subtitle={`${activeBrand === 'robothink' ? 'RoboThink' : 'Creative IQ'} · ${isAllCentres ? 'All centres' : (selectedCentre?.name ?? 'Working centre')}`}
        accent="blue"
        actions={
          <button className="btn-ghost" onClick={() => void load()}>
            Refresh
          </button>
        }
      />
      <section className="card p-4 mb-5" aria-label="Dashboard period">
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-sm">
            From
            <input
              className="block mt-1 border rounded-lg p-2"
              type="date"
              value={from}
              onChange={(event) => setFrom(event.target.value)}
            />
          </label>
          <label className="text-sm">
            To
            <input
              className="block mt-1 border rounded-lg p-2"
              type="date"
              value={to}
              onChange={(event) => setTo(event.target.value)}
            />
          </label>
          <button className="btn-ghost" onClick={() => selectRange(today, today)}>
            Today
          </button>
          <button className="btn-ghost" onClick={() => selectRange(mondayOf(today), addDays(mondayOf(today), 6))}>
            This week
          </button>
          <button
            className="btn-ghost"
            onClick={() => selectRange(addDays(mondayOf(today), -7), addDays(mondayOf(today), -1))}
          >
            Last week
          </button>
          <button className="btn-ghost" onClick={() => selectRange(`${today.slice(0, 7)}-01`, today)}>
            This month
          </button>
        </div>
        <p className="text-xs text-slate-600 mt-3">
          Weeks run Monday–Sunday. Attendance counts through today; future catch-ups are bookings. Follow-ups and
          concerns show the current position across recorded history.
        </p>
        {!validRange && (
          <p role="alert" className="text-sm text-rose-700 mt-2">
            Choose a valid date range of up to one year.
          </p>
        )}
      </section>
      {stats && (
        <>
          <section className="mb-6" aria-labelledby="attention-title">
            <h2 id="attention-title" className="text-lg font-semibold mb-3">
              Needs attention
            </h2>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <a href="#term-time-followups">
                <StatCard
                  label="Term-time follow-ups due"
                  value={stats.due.length}
                  tone={stats.due.length ? 'warn' : undefined}
                />
              </a>
              <a href="#term-time-followups">
                <StatCard label="Awaiting parent reply" value={stats.awaitingReply.length} />
              </a>
              <a href="#term-time-followups">
                <StatCard
                  label="Overdue follow-ups"
                  value={stats.overdue.length}
                  tone={stats.overdue.length ? 'bad' : undefined}
                />
              </a>
              <a href="#feedback-outstanding">
                <StatCard label="Feedback outstanding" value={stats.feedbackOutstanding.length} />
              </a>
            </div>
          </section>
          <section className="mb-6" aria-labelledby="period-title">
            <h2 id="period-title" className="text-lg font-semibold mb-3">
              {formatShortDate(from)} – {formatShortDate(to)}
            </h2>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <button className="text-left" onClick={() => setTab('attended')}>
                <StatCard label="Students attended" value={stats.uniqueAttended} tone="good" />
              </button>
              <button className="text-left" onClick={() => setTab('attended')}>
                <StatCard label="Sessions attended" value={stats.attended.length} />
              </button>
              <button className="text-left" onClick={() => setTab('missed')}>
                <StatCard label="Missed classes" value={stats.missed.length} />
              </button>
              <button className="text-left" onClick={() => setTab('missed')}>
                <StatCard
                  label="Outstanding absences"
                  value={stats.outstanding.length}
                  tone={stats.outstanding.length ? 'warn' : undefined}
                />
              </button>
              <button className="text-left" onClick={() => setTab('catchups')}>
                <StatCard label="Catch-ups attended" value={stats.catchUpsAttended} />
              </button>
              <button className="text-left" onClick={() => setTab('missed')}>
                <StatCard label="Absences made up" value={stats.madeUp.length} />
              </button>
              <button className="text-left" onClick={() => setTab('unmarked')}>
                <StatCard label="Unmarked registers" value={stats.unmarked.length} />
              </button>
              <StatCard
                label="Attendance after make-ups"
                value={stats.percentage == null ? '—' : `${stats.percentage}%`}
              />
            </div>
            <p className="text-xs text-slate-600 mt-3">
              {stats.expected} scheduled sessions through today · {stats.stillDue} scheduled later in this period ·{' '}
              {stats.catchUpsBooked} catch-ups booked · {stats.catchUpsMissed} catch-ups missed. Made-up absences remain
              listed as missed classes, with their make-up date. Extra sessions never count twice.
            </p>
          </section>
          <section className="card p-4 mb-6" aria-labelledby="attendance-list-title">
            <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
              <h2 id="attendance-list-title" className="font-semibold">
                Student attendance
              </h2>
              <label className="text-sm">
                Find student
                <input
                  type="search"
                  className="ml-2 border rounded-lg p-2"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </label>
            </div>
            <div role="tablist" aria-label="Attendance lists" className="flex flex-wrap gap-2 mb-3">
              {TABS.map((item) => (
                <button
                  key={item.id}
                  role="tab"
                  id={`tab-${item.id}`}
                  aria-controls="attendance-panel"
                  aria-selected={tab === item.id}
                  className={tab === item.id ? 'btn-primary text-sm' : 'btn-ghost text-sm'}
                  onClick={() => setTab(item.id)}
                >
                  {item.label} ({tabCounts?.[item.id]})
                </button>
              ))}
            </div>
            <div role="tabpanel" id="attendance-panel" aria-labelledby={`tab-${tab}`}>
              {tab === 'unmarked' ? (
                stats.unmarked.filter((row) => matches(row.student)).length ? (
                  <ul className="divide-y divide-slate-100">
                    {stats.unmarked
                      .filter((row) => matches(row.student))
                      .map((row) => (
                        <li
                          key={`${row.student.id}-${row.date}`}
                          className="py-3 text-sm flex flex-wrap justify-between gap-2"
                        >
                          <div>
                            <Link to={`/students/${row.student.id}`} className="font-medium hover:underline">
                              {row.student.full_name}
                            </Link>
                            <span className="text-slate-600">
                              {' '}
                              · {centreName(row.student)} · {formatShortDate(row.date)}
                            </span>
                          </div>
                          <span>{row.reason}</span>
                        </li>
                      ))}
                  </ul>
                ) : (
                  <p className="text-sm text-slate-600 py-4">No unmarked registers in this period.</p>
                )
              ) : rows.filter((row) => matches(row.student)).length ? (
                <ul className="divide-y divide-slate-100">
                  {rows
                    .filter((row) => matches(row.student))
                    .map((row) => (
                      <li
                        key={`${row.student.id}-${row.id}`}
                        className="py-3 text-sm flex flex-wrap justify-between gap-2"
                      >
                        <div>
                          <Link to={`/students/${row.student.id}`} className="font-medium hover:underline">
                            {row.student.full_name}
                          </Link>
                          <span className="text-slate-600">
                            {' '}
                            · {centreName(row.student)} · {formatShortDate(row.date)}
                            {row.sessionNumber != null ? ` · session ${row.sessionNumber}` : ''}
                          </span>
                        </div>
                        <span>
                          {row.makeUpDate
                            ? `Made up ${formatShortDate(row.makeUpDate)}`
                            : row.absenceDate
                              ? `Made up absence on ${formatShortDate(row.absenceDate)}`
                              : isAttended(row)
                                ? row.kind === 'extra'
                                  ? 'Extra session attended'
                                  : 'Attended'
                                : row.kind === 'extra_missed'
                                  ? 'Catch-up missed'
                                  : row.status === 'Absent'
                                    ? 'Outstanding absence'
                                    : row.date >= today
                                      ? 'Booked'
                                      : 'Not marked'}
                          {row.session_type === 'special'
                            ? ' · special'
                            : row.kind === 'extra' || row.catch_up || row.session_type === 'catch_up'
                              ? ' · catch-up'
                              : ''}
                        </span>
                      </li>
                    ))}
                </ul>
              ) : (
                <p className="text-sm text-slate-600 py-4">No matching students in this list.</p>
              )}
            </div>
          </section>
          <div className="grid xl:grid-cols-2 gap-6 mb-6">
            <TermTimeFollowupsPanel
              entries={stats.termTime}
              editable={role === 'admin' || role === 'management'}
              today={today}
              onSave={saveFollowup}
            />
            <section className="card p-4">
              <h2 className="font-semibold mb-3">Attendance concerns</h2>
              <p className="text-xs text-slate-600 mb-2">
                Unresolved recent absences, repeated misses and long gaps. Made-up absences are excluded; fortnightly
                students have a longer gap allowance.
              </p>
              {stats.concerns.length ? (
                <ul className="divide-y divide-slate-100">
                  {stats.concerns.map(({ student, label, lastAttended }) => (
                    <li key={student.id} className="py-3 text-sm">
                      <Link to={`/students/${student.id}`} className="font-medium hover:underline">
                        {student.full_name}
                      </Link>
                      <p className="text-xs text-slate-600 mt-1">
                        {label} · {centreName(student)} ·{' '}
                        {lastAttended
                          ? `last attended ${formatShortDate(lastAttended)}`
                          : 'No attended session recorded'}
                      </p>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-slate-600">No attendance concerns flagged.</p>
              )}
            </section>
            <section id="feedback-outstanding" className="card p-4 scroll-mt-4">
              <h2 className="font-semibold mb-3">Outstanding feedback</h2>
              {stats.feedbackOutstanding.length ? (
                <ul className="divide-y divide-slate-100">
                  {stats.feedbackOutstanding.map((feedback) => (
                    <li key={feedback.id} className="py-2 text-sm">
                      <Link to={`/students/${feedback.student_id}`} className="font-medium hover:underline">
                        {studentById.get(feedback.student_id)?.full_name}
                      </Link>
                      <span className="text-slate-600">
                        {' '}
                        · {feedback.status === 'not_written' ? 'Not written' : 'Written, not given'} · waiting since{' '}
                        {formatShortDate(feedback.created_at.slice(0, 10))}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-slate-600">All feedback has been given.</p>
              )}
            </section>
            {stats.legacyFollowups.length > 0 && (
              <section className="card p-4">
                <h2 className="font-semibold mb-2">Earlier follow-ups</h2>
                <p className="text-xs text-slate-600 mb-3">
                  These were created under the previous lesson-based rule and are kept for reference. New reminders use
                  attended sessions.
                </p>
                <ul className="text-sm space-y-2">
                  {stats.legacyFollowups.map((row) => (
                    <li key={row.id}>
                      <Link to={`/students/${row.student_id}`} className="font-medium hover:underline">
                        {studentById.get(row.student_id)?.full_name}
                      </Link>
                      <span className="text-slate-600">
                        {' '}
                        · {row.status.replaceAll('_', ' ')}
                        {row.notes ? ` · ${row.notes}` : ''}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
          <details className="mb-6">
            <summary className="font-semibold cursor-pointer mb-3">Enrolment and scheduled sessions</summary>
            <div className="grid xl:grid-cols-2 gap-6">
              <section className="card p-4">
                <h2 className="font-semibold mb-3">
                  {activeStudents.length} active students · {newStudents.length} new this month
                </h2>
                {newStudents.length ? (
                  <ul className="text-sm space-y-2">
                    {newStudents.map((student) => (
                      <li key={student.id}>
                        <Link to={`/students/${student.id}`} className="font-medium hover:underline">
                          {student.full_name}
                        </Link>
                        <span className="text-slate-600"> · joined {formatShortDate(student.date_joined!)}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-slate-600">No new students this month.</p>
                )}
              </section>
              <section className="card p-4">
                <h2 className="font-semibold mb-2">Scheduled by day and time</h2>
                <p className="text-xs text-slate-600 mb-3">
                  Typical active student schedules, including multiple weekly slots. Fortnightly students attend only in
                  their on weeks.
                </p>
                {schedules.length ? (
                  <ul className="text-sm space-y-2">
                    {schedules.map((slot) => (
                      <li key={`${slot.day}|${slot.time ?? ''}`} className="flex justify-between gap-2">
                        <span>
                          {slot.day} · {formatTime12h(slot.time)}
                        </span>
                        <span>{slot.students.size} students</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-slate-600">No schedules set.</p>
                )}
              </section>
            </div>
          </details>
          <details className="mb-6">
            <summary className="font-semibold cursor-pointer mb-3">Attendance trends · last 12 weeks</summary>
            <div className="grid xl:grid-cols-2 gap-6">
              <AttendanceTrendChart points={weekPoints} />
              <CentreAttendanceChart points={centrePoints} />
              <StudentRetentionChart cohorts={studentRetentionCohorts(data.students, weekStarts, today)} />
            </div>
          </details>
        </>
      )}
    </div>
  )
}
