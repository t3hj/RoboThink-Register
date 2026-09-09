import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../lib/auth'
import { useToast } from '../components/Toast'
import {
  PageHeader,
  LoadingPanel,
  ErrorPanel,
  EmptyState,
  StatusBadge,
  SubscriptionBadge,
  ConfirmDialog,
} from '../components/ui'
import { todayISO, dayName, nowHM, formatDisplayDate, addDays } from '../lib/dates'
import type { Attendance, Student } from '../types'

interface RosterEntry extends Student {
  attendance: Attendance | null
  next_lesson: number | null
  level_name: string | null
}

export default function Register() {
  const { profile } = useAuth()
  const { notify } = useToast()
  const [date, setDate] = useState(todayISO())
  const [roster, setRoster] = useState<RosterEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [confirmTarget, setConfirmTarget] = useState<RosterEntry | null>(null)

  const loadRoster = useCallback(
    async (forDate: string) => {
      setLoading(true)
      setError(null)
      const dow = dayName(forDate)

      const { data: scheduled, error: schedErr } = await supabase
        .from('students')
        .select('*, levels(name), subscriptions(name)')
        .eq('preferred_day', dow)
        .order('preferred_time')

      if (schedErr) {
        setError(schedErr.message)
        setLoading(false)
        return
      }

      const { data: att, error: attErr } = await supabase
        .from('attendance')
        .select('*')
        .eq('date', forDate)

      if (attErr) {
        setError(attErr.message)
        setLoading(false)
        return
      }

      // Students attending on a different day (catch-up) that aren't scheduled today.
      const attendance = (att ?? []) as Attendance[]
      const scheduledIds = new Set((scheduled ?? []).map((s) => s.id))
      const extraIds = [...new Set(attendance.map((a) => a.student_id))].filter((id) => !scheduledIds.has(id))
      let extras: Student[] = []
      if (extraIds.length) {
        const { data: extraData, error: extraErr } = await supabase
          .from('students')
          .select('*, levels(name), subscriptions(name)')
          .in('id', extraIds)
        if (extraErr) {
          setError(extraErr.message)
          setLoading(false)
          return
        }
        extras = (extraData ?? []) as Student[]
      }

      const everyone = [...((scheduled ?? []) as Student[]), ...extras]
      const ids = everyone.map((s) => s.id)

      // Batch next-lesson + level for all students in one query.
      let progress: { student_id: string; next_lesson: number | null }[] = []
      if (ids.length) {
        const { data: prog, error: progErr } = await supabase
          .from('student_progress')
          .select('student_id, next_lesson')
          .in('student_id', ids)
        if (progErr) {
          setError(progErr.message)
          setLoading(false)
          return
        }
        progress = (prog ?? []) as { student_id: string; next_lesson: number | null }[]
      }
      const progMap = new Map(progress.map((p) => [p.student_id, p.next_lesson]))
      const attMap = new Map(attendance.map((a) => [a.student_id, a]))

      const entries: RosterEntry[] = everyone.map((s) => ({
        ...s,
        attendance: attMap.get(s.id) ?? null,
        next_lesson: progMap.get(s.id) ?? null,
        level_name: s.levels?.name ?? null,
      }))

      // Scheduled first (by time), then catch-up attendees.
      entries.sort((a, b) => {
        const aSched = a.preferred_day === dow ? 0 : 1
        const bSched = b.preferred_day === dow ? 0 : 1
        if (aSched !== bSched) return aSched - bSched
        return (a.preferred_time ?? '').localeCompare(b.preferred_time ?? '')
      })
      setRoster(entries)
      setLoading(false)
    },
    [],
  )

  useEffect(() => {
    void loadRoster(date)
  }, [date, loadRoster])

  async function upsertAttendance(
    student: RosterEntry,
    values: Partial<Attendance> & { status: Attendance['status'] },
  ) {
    if (!profile) {
      notify('Your profile is not loaded — cannot record who made this change.', 'error')
      return false
    }
    const { error: err } = await supabase.from('attendance').upsert(
      {
        student_id: student.id,
        date,
        scheduled_day: student.preferred_day ?? dayName(date),
        actual_day: dayName(date),
        instructor_id: profile.id,
        ...values,
      },
      { onConflict: 'student_id,date' },
    )
    if (err) {
      notify(err.message, 'error')
      return false
    }
    return true
  }

  async function markArrived(student: RosterEntry) {
    setBusyId(student.id)
    const ok = await upsertAttendance(student, { status: 'Arrived', time_in: nowHM() })
    setBusyId(null)
    if (ok) {
      notify(`${student.full_name} marked arrived`, 'success')
      void loadRoster(date)
    }
  }

  async function markAbsent(student: RosterEntry) {
    setBusyId(student.id)
    const ok = await upsertAttendance(student, { status: 'Absent', time_in: null, time_out: null })
    setBusyId(null)
    if (ok) {
      notify(`${student.full_name} marked absent`, 'success')
      void loadRoster(date)
    }
  }

  async function markTimeOut(student: RosterEntry) {
    setBusyId(student.id)
    const { error: err } = await supabase
      .from('attendance')
      .update({ time_out: nowHM() })
      .eq('student_id', student.id)
      .eq('date', date)
    setBusyId(null)
    if (err) {
      notify(err.message, 'error')
      return
    }
    notify(`${student.full_name} timed out`, 'success')
    void loadRoster(date)
  }

  async function completeLesson(student: RosterEntry) {
    setConfirmTarget(null)
    if (student.next_lesson == null) {
      notify('No next lesson available for this student.', 'error')
      return
    }
    if (!profile) {
      notify('Your profile is not loaded — cannot record the instructor.', 'error')
      return
    }
    setBusyId(student.id)
    // Insert is idempotent thanks to UNIQUE(student_id, level_id, lesson_number);
    // ignore duplicate violations so double-clicks never create two records.
    const { error: lessonErr } = await supabase.from('lesson_records').insert({
      student_id: student.id,
      level_id: student.current_level_id!,
      lesson_number: student.next_lesson,
      date,
      instructor_id: profile.id,
      status: 'completed',
    })
    if (lessonErr && lessonErr.code !== '23505') {
      setBusyId(null)
      notify(lessonErr.message, 'error')
      return
    }
    const ok = await upsertAttendance(student, { status: 'Completed', time_out: nowHM() })
    setBusyId(null)
    if (ok) {
      notify(`Lesson ${student.next_lesson} recorded for ${student.full_name}`, 'success')
      void loadRoster(date)
    }
  }

  const summary = useMemo(() => {
    const counts = { arrived: 0, absent: 0, completed: 0, unmarked: 0 }
    for (const s of roster) {
      const st = s.attendance?.status
      if (st === 'Arrived') counts.arrived++
      else if (st === 'Absent') counts.absent++
      else if (st === 'Completed') counts.completed++
      else counts.unmarked++
    }
    return counts
  }, [roster])


  if (loading) return <LoadingPanel label="Loading register…" />
  if (error) return <ErrorPanel message={error} onRetry={() => void loadRoster(date)} />

  return (
    <div>
      <PageHeader
        title="Register"
        subtitle={`${formatDisplayDate(date)} · ${dayName(date)}`}
        actions={
          <>
            <button className="btn-ghost" onClick={() => setDate(addDays(date, -1))} aria-label="Previous day">
              ← Prev
            </button>
            <input
              type="date"
              value={date}
              onChange={(e) => e.target.value && setDate(e.target.value)}
              className="p-2 border border-slate-200 rounded-lg text-sm"
            />
            <button className="btn-ghost" onClick={() => setDate(addDays(date, 1))} aria-label="Next day">
              Next →
            </button>
            {date !== todayISO() && (
              <button className="btn-ghost" onClick={() => setDate(todayISO())}>
                Today
              </button>
            )}
          </>
        }
      />

      <div className="flex flex-wrap gap-2 mb-4">
        <span className="badge badge-arrived">{summary.arrived} in centre</span>
        <span className="badge badge-absent">{summary.absent} absent</span>
        <span className="badge">{summary.completed} completed</span>
        <span className="badge">{summary.unmarked} not marked</span>
      </div>

      {roster.length === 0 ? (
        <EmptyState
          title="No students scheduled or attending"
          hint={`Nobody has ${dayName(date)} as their preferred day and there are no attendance records for this date.`}
        />
      ) : (
        <div className="card divide-y divide-slate-100">
          {roster.map((s) => {
            const att = s.attendance
            const busy = busyId === s.id
            return (
              <div key={s.id} className="p-3 sm:p-4 flex flex-col sm:flex-row sm:items-center gap-3">
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <div className="w-10 h-10 rounded-md bg-slate-100 flex items-center justify-center text-sm font-semibold shrink-0">
                    {s.full_name.split(' ').map((n) => n[0]).slice(0, 2).join('')}
                  </div>
                  <div className="min-w-0">
                    <div className="font-medium flex items-center gap-2 flex-wrap">
                      <Link to={`/students/${s.id}`} className="hover:underline">{s.full_name}</Link>
                      {s.preferred_day !== dayName(date) && <span className="badge">Catch-up</span>}
                      {!s.active && <span className="badge badge-absent">Inactive</span>}
                    </div>
                    <div className="text-xs text-slate-500 flex flex-wrap gap-x-2">
                      <span>{s.level_name ?? `Level ${s.current_level_id ?? '—'}`}</span>
                      <span>· {s.preferred_day} {s.preferred_time}</span>
                      {att?.time_in && <span>· in {att.time_in}</span>}
                      {att?.time_out && <span>· out {att.time_out}</span>}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
                  <div className="hidden md:block">
                    <SubscriptionBadge subscriptionId={s.subscription_id} />
                  </div>
                  <div className="text-xs text-slate-500">
                    Next: <span className="font-semibold text-slate-700">{s.next_lesson ?? '—'}</span>
                  </div>
                  {att ? <StatusBadge status={att.status} /> : <span className="badge">Not Arrived</span>}

                  <div className="flex gap-2 sm:ml-2">
                    {!att || att.status === 'Not Arrived' ? (
                      <>
                        <button className="btn-primary text-sm" disabled={busy} onClick={() => void markArrived(s)}>
                          {busy ? '…' : 'Arrived'}
                        </button>
                        <button className="btn-ghost text-sm" disabled={busy} onClick={() => void markAbsent(s)}>
                          Absent
                        </button>
                      </>
                    ) : att.status === 'Arrived' ? (
                      <>
                        <button className="btn-ghost text-sm" disabled={busy} onClick={() => void markTimeOut(s)}>
                          Time Out
                        </button>
                        <button
                          className="btn-primary text-sm"
                          disabled={busy || s.next_lesson == null}
                          onClick={() => setConfirmTarget(s)}
                        >
                          Mark Done
                        </button>
                      </>
                    ) : att.status === 'Absent' ? (
                      <button className="btn-ghost text-sm" disabled={busy} onClick={() => void markArrived(s)}>
                        Mark Arrived
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      <ConfirmDialog
        open={confirmTarget != null}
        title="Mark lesson complete?"
        message={
          confirmTarget
            ? `Record lesson ${confirmTarget.next_lesson} as completed for ${confirmTarget.full_name}, attributed to ${profile?.name ?? 'you'}, and mark them as Completed on the register?`
            : ''
        }
        confirmLabel="Record lesson"
        onConfirm={() => confirmTarget && void completeLesson(confirmTarget)}
        onCancel={() => setConfirmTarget(null)}
      />
    </div>
  )
}

