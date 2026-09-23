import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { PageHeader, LoadingPanel, ErrorPanel, EmptyState, SubscriptionBadge } from '../components/ui'
import LessonsToday from '../components/LessonsToday'
import FeedbackControl from '../components/FeedbackControl'
import AddToRegister from '../components/AddToRegister'
import AssessmentPanel from '../components/AssessmentPanel'
import SessionEntryRow from '../components/SessionEntryRow'
import BulkActionBar from '../components/BulkActionBar'
import BulkAttendanceModal from '../components/BulkAttendanceModal'
import BulkSessionModal from '../components/BulkSessionModal'
import BulkFeedbackModal from '../components/BulkFeedbackModal'
import { RobotBadge } from '../components/RobotArt'
import { todayISO, dayName, formatDisplayDate, addDays, formatTime12h, formatShortDate } from '../lib/dates'
import { levelLabel } from '../lib/curriculum'
import { loadCurriculum } from '../lib/curriculumData'
import { findOutstandingFeedback, FEEDBACK_SHORT } from '../lib/feedback'
import { registerCompleteness, needsLeftAsideReminder } from '../lib/attendedSessionsUi'
import { resolveFeedbackTarget } from '../lib/bulkActions'
import type {
  Attendance,
  AttendedSession,
  FeedbackSheet,
  Lesson,
  Level,
  LessonRecord,
  RemediationPlan,
  Student,
  StudentProgress,
} from '../types'

interface RosterEntry extends Student {
  attendance: Attendance | null
  progress: StudentProgress | null
  plan: RemediationPlan | null
  feedback: FeedbackSheet | null
  sessionsToday: AttendedSession[]
  mostRecentSession: AttendedSession | null
  previouslyCompleted: Map<number, string>
}

export default function Register() {
  const [date, setDate] = useState(todayISO())
  const [roster, setRoster] = useState<RosterEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [levels, setLevels] = useState<Level[]>([])
  const [lessons, setLessons] = useState<Lesson[]>([])
  const [showAdd, setShowAdd] = useState(false)
  const [feedbackByStudent, setFeedbackByStudent] = useState<Map<string, FeedbackSheet[]>>(new Map())
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkModal, setBulkModal] = useState<'attended' | 'absent' | 'lesson_outcome' | 'not_finished' | 'feedback' | null>(null)

  useEffect(() => {
    void loadCurriculum().then(({ levels: lv, lessons: le }) => {
      setLevels(lv)
      setLessons(le)
    })
  }, [])

  const loadRoster = useCallback(async (forDate: string) => {
    setLoading(true)
    setError(null)
    const dow = dayName(forDate)

    // Active students only — inactive students never appear in the normal
    // Register or its completeness counts.
    const { data: scheduled, error: schedErr } = await supabase
      .from('students')
      .select('*, levels(name), subscriptions(name)')
      .eq('preferred_day', dow)
      .eq('active', true)
      .order('preferred_time')

    if (schedErr) {
      setError(schedErr.message)
      setLoading(false)
      return
    }

    const { data: att, error: attErr } = await supabase.from('attendance').select('*').eq('date', forDate)
    if (attErr) {
      setError(attErr.message)
      setLoading(false)
      return
    }

    const attendance = (att ?? []) as Attendance[]
    const scheduledIds = new Set((scheduled ?? []).map((s) => s.id))
    // Catch-up/special students: anyone with an attendance row for this
    // date who wasn't already in the normal scheduled list. Restricted to
    // active students, same as the scheduled query.
    const extraIds = [...new Set(attendance.map((a) => a.student_id))].filter((id) => !scheduledIds.has(id))
    let extras: Student[] = []
    if (extraIds.length) {
      const { data: extraData, error: extraErr } = await supabase
        .from('students')
        .select('*, levels(name), subscriptions(name)')
        .in('id', extraIds)
        .eq('active', true)
      if (extraErr) {
        setError(extraErr.message)
        setLoading(false)
        return
      }
      extras = (extraData ?? []) as Student[]
    }

    const everyone = [...((scheduled ?? []) as Student[]), ...extras]
    const ids = everyone.map((s) => s.id)

    let progress: StudentProgress[] = []
    let plans: RemediationPlan[] = []
    let feedbackSheets: FeedbackSheet[] = []
    let sessionsForDate: AttendedSession[] = []
    let recentSessions: AttendedSession[] = []
    let completedLessons: LessonRecord[] = []

    if (ids.length) {
      const [progRes, planRes, feedbackRes, sessionsRes, recentRes, completedRes] = await Promise.all([
        supabase.from('student_progress').select('*').in('student_id', ids),
        supabase
          .from('remediation_plans')
          .select('*')
          .in('student_id', ids)
          .in('status', ['required', 'in_progress', 'ready_for_reassessment', 'intervention_required']),
        // Outstanding feedback, by student_id only — deliberately NOT
        // filtered by date/schedule, so it follows the student to
        // whatever session they next appear at (normal day, catch-up, or
        // any other day).
        supabase.from('feedback_sheets').select('*').in('student_id', ids).neq('status', 'given'),
        // Existing sessions for THIS date — loading/reloading the
        // register must reflect what's already saved, never create new
        // ones just by opening the page.
        supabase.from('attended_sessions').select('*').eq('date', forDate).in('student_id', ids),
        // Each student's most recent session overall (any date), to drive
        // the "build left aside" reminder regardless of which day they
        // next appear on.
        supabase
          .from('attended_sessions')
          .select('*')
          .in('student_id', ids)
          .order('date', { ascending: false })
          .order('session_number', { ascending: false }),
        supabase.from('lesson_records').select('*').in('student_id', ids).eq('status', 'completed'),
      ])
      if (progRes.error) {
        setError(progRes.error.message)
        setLoading(false)
        return
      }
      progress = (progRes.data ?? []) as StudentProgress[]
      plans = (planRes.data ?? []) as RemediationPlan[]
      feedbackSheets = (feedbackRes.data ?? []) as FeedbackSheet[]
      sessionsForDate = (sessionsRes.data ?? []) as AttendedSession[]
      recentSessions = (recentRes.data ?? []) as AttendedSession[]
      completedLessons = (completedRes.data ?? []) as LessonRecord[]
    }

    const progMap = new Map(progress.map((p) => [p.student_id, p]))
    const planMap = new Map(plans.map((p) => [p.student_id, p]))
    const attMap = new Map(attendance.map((a) => [a.student_id, a]))
    const feedbackByStudentMap = new Map<string, FeedbackSheet[]>()
    for (const f of feedbackSheets) {
      feedbackByStudentMap.set(f.student_id, [...(feedbackByStudentMap.get(f.student_id) ?? []), f])
    }
    setFeedbackByStudent(feedbackByStudentMap)
    const sessionsByStudent = new Map<string, AttendedSession[]>()
    for (const s of sessionsForDate) {
      sessionsByStudent.set(s.student_id, [...(sessionsByStudent.get(s.student_id) ?? []), s].sort((a, b) => a.session_number - b.session_number))
    }
    const mostRecentByStudent = new Map<string, AttendedSession>()
    for (const s of recentSessions) {
      if (!mostRecentByStudent.has(s.student_id)) mostRecentByStudent.set(s.student_id, s)
    }
    const completedByStudent = new Map<string, Map<number, string>>()
    for (const lr of completedLessons) {
      const m = completedByStudent.get(lr.student_id) ?? new Map<number, string>()
      m.set(lr.lesson_number, lr.date)
      completedByStudent.set(lr.student_id, m)
    }

    const entries: RosterEntry[] = everyone.map((s) => ({
      ...s,
      attendance: attMap.get(s.id) ?? null,
      progress: progMap.get(s.id) ?? null,
      plan: planMap.get(s.id) ?? null,
      feedback: findOutstandingFeedback(feedbackByStudentMap.get(s.id) ?? []),
      sessionsToday: sessionsByStudent.get(s.id) ?? [],
      mostRecentSession: mostRecentByStudent.get(s.id) ?? null,
      previouslyCompleted: completedByStudent.get(s.id) ?? new Map(),
    }))

    entries.sort((a, b) => {
      const aSched = a.preferred_day === dow ? 0 : 1
      const bSched = b.preferred_day === dow ? 0 : 1
      if (aSched !== bSched) return aSched - bSched
      return (a.preferred_time ?? '').localeCompare(b.preferred_time ?? '')
    })
    setRoster(entries)
    setLoading(false)
  }, [])

  useEffect(() => {
    void loadRoster(date)
  }, [date, loadRoster])

  useEffect(() => {
    setSelected(new Set())
  }, [date])

  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const selectedRoster = useMemo(() => roster.filter((s) => selected.has(s.id)), [roster, selected])

  const attendanceCandidates = useMemo(
    () => selectedRoster.map((s) => ({ id: s.id, full_name: s.full_name, status: s.attendance?.status, sessionCount: s.sessionsToday.length })),
    [selectedRoster],
  )
  const sessionCandidates = useMemo(
    () =>
      selectedRoster.map((s) => ({
        id: s.id,
        full_name: s.full_name,
        status: s.attendance?.status,
        sessionCount: s.sessionsToday.length,
        currentLessonId: s.current_lesson_id,
        currentLevelId: s.current_level_id,
      })),
    [selectedRoster],
  )
  const feedbackCandidates = useMemo(
    () =>
      selectedRoster.map((s) => {
        const { targetSessionNumber, feedbackId } = resolveFeedbackTarget(s.sessionsToday, feedbackByStudent.get(s.id) ?? [])
        return {
          id: s.id,
          full_name: s.full_name,
          status: s.attendance?.status,
          sessionCount: s.sessionsToday.length,
          targetSessionNumber,
          feedbackId,
        }
      }),
    [selectedRoster, feedbackByStudent],
  )

  const feedbackOutstanding = useMemo(() => roster.filter((s) => s.feedback != null), [roster])
  const buildReminders = useMemo(() => roster.filter((s) => needsLeftAsideReminder(s.mostRecentSession)), [roster])
  const isHistorical = date < todayISO()
  const isFuture = date > todayISO()
  const completeness = useMemo(() => registerCompleteness(roster.map((s) => ({ status: s.attendance?.status }))), [roster])

  const timeGroups = useMemo(() => {
    const groups = new Map<string, RosterEntry[]>()
    for (const s of roster) {
      const key = s.preferred_time ?? ''
      groups.set(key, [...(groups.get(key) ?? []), s])
    }
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [roster])

  if (loading) return <LoadingPanel label="Loading register…" />
  if (error) return <ErrorPanel message={error} onRetry={() => void loadRoster(date)} />

  return (
    <div>
      <PageHeader
        title="Register"
        subtitle={`${formatDisplayDate(date)} · ${dayName(date)}${isHistorical ? ' · Historical' : isFuture ? ' · Upcoming' : ''}`}
        accent="green"
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
              aria-label="Select register date"
            />
            <button className="btn-ghost" onClick={() => setDate(addDays(date, 1))} aria-label="Next day">
              Next →
            </button>
            {date !== todayISO() && (
              <button className="btn-ghost" onClick={() => setDate(todayISO())}>
                Today
              </button>
            )}
            <button className="btn-primary" onClick={() => setShowAdd(true)}>
              + Add to register
            </button>
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <span className="badge bg-[color:var(--rt-blue-tint)] text-[color:var(--rt-blue)]" aria-label="Register completeness">
          {completeness.recorded} / {completeness.total} recorded
        </span>
        {completeness.notEntered > 0 && (
          <span className="badge badge-assess">{completeness.notEntered} not entered yet</span>
        )}
      </div>

      {selected.size > 0 && (
        <BulkActionBar
          count={selected.size}
          onSelectAll={() => setSelected(new Set(roster.map((s) => s.id)))}
          onClear={() => setSelected(new Set())}
          onMarkAttended={() => setBulkModal('attended')}
          onMarkAbsent={() => setBulkModal('absent')}
          onLessonOutcome={() => setBulkModal('lesson_outcome')}
          onNotFinished={() => setBulkModal('not_finished')}
          onFeedback={() => setBulkModal('feedback')}
        />
      )}

      {buildReminders.length > 0 && (
        <section className="card card-accent-top p-3 mb-4" style={{ ['--accent-color' as string]: 'var(--rt-yellow)' }} aria-label="Build/laptop reminders">
          <h3 className="font-semibold text-sm mb-2 flex items-center gap-2">
            <span aria-hidden>🔧</span> Builds left aside — {buildReminders.length}
          </h3>
          <ul className="flex flex-col gap-1">
            {buildReminders.map((s) => (
              <li key={s.id} className="text-sm">
                <Link to={`/students/${s.id}`} className="font-medium hover:underline">{s.full_name}</Link>
                {' — use build '}
                <strong>{s.mostRecentSession?.left_aside_identifier}</strong>
                {' to finish the lesson'}
                {s.mostRecentSession?.date && <span className="text-slate-400"> (left {formatShortDate(s.mostRecentSession.date)})</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {feedbackOutstanding.length > 0 && (
        <section className="card card-accent-top p-3 mb-4" style={{ ['--accent-color' as string]: 'var(--rt-red)' }} aria-label="Feedback reminders">
          <h3 className="font-semibold text-sm mb-2 flex items-center gap-2">
            <RobotBadge className="w-6 h-6" /> Feedback reminders — {feedbackOutstanding.length}
          </h3>
          <ul className="flex flex-col gap-1.5">
            {feedbackOutstanding.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-3 text-sm">
                <span>
                  <Link to={`/students/${s.id}`} className="font-medium hover:underline">{s.full_name}</Link>
                  {' — '}
                  {FEEDBACK_SHORT[s.feedback!.status]}
                </span>
                <FeedbackControl
                  feedbackId={s.feedback!.id}
                  status={s.feedback!.status}
                  studentName={s.full_name}
                  onChanged={() => void loadRoster(date)}
                  variant="full"
                />
              </li>
            ))}
          </ul>
        </section>
      )}

      {roster.length > 0 && (
        <div className="flex items-center gap-2 mb-3 px-1">
          <label className="flex items-center gap-1.5 text-sm text-slate-500">
            <input
              type="checkbox"
              checked={selected.size === roster.length}
              onChange={(e) => setSelected(e.target.checked ? new Set(roster.map((s) => s.id)) : new Set())}
            />
            Select all
          </label>
        </div>
      )}

      <LessonsToday roster={roster} levels={levels} />

      {roster.length === 0 ? (
        <EmptyState
          title="No students scheduled or attending"
          hint={`Nobody active has ${dayName(date)} as their preferred day and there are no attendance records for this date.`}
          robot
        />
      ) : (
        <div className="flex flex-col gap-4">
          {timeGroups.map(([time, entries]) => (
            <div key={time || 'no-time'}>
              <h3 className="text-sm font-semibold text-slate-500 mb-2 px-1">
                {formatTime12h(time)} <span className="text-slate-400 font-normal">· {entries.length} student{entries.length === 1 ? '' : 's'}</span>
              </h3>
              <div className="card divide-y divide-slate-100">
                {entries.map((s) => {
                  const sessionFeedbackMap = new Map(
                    (feedbackByStudent.get(s.id) ?? [])
                      .filter((f) => f.attended_session_id)
                      .map((f) => [f.attended_session_id as string, f]),
                  )
                  return (
                    <div key={s.id} className="p-3 sm:p-4 flex flex-col gap-3">
                      <div className="flex flex-col sm:flex-row sm:items-start gap-3">
                        <div className="flex items-center gap-3 flex-1 min-w-0">
                          <input
                            type="checkbox"
                            className="w-5 h-5 shrink-0"
                            checked={selected.has(s.id)}
                            onChange={() => toggleSelected(s.id)}
                            aria-label={`Select ${s.full_name}`}
                          />
                          <div className="w-10 h-10 rounded-md bg-slate-100 flex items-center justify-center text-sm font-semibold shrink-0">
                            {s.full_name.split(' ').map((n) => n[0]).slice(0, 2).join('')}
                          </div>
                          <div className="min-w-0">
                            <div className="font-medium flex items-center gap-2 flex-wrap">
                              <Link to={`/students/${s.id}`} className="hover:underline">{s.full_name}</Link>
                              {s.attendance?.session_type === 'catch_up' && <span className="badge">Catch-up</span>}
                              {s.attendance?.session_type === 'special' && <span className="badge">Special session</span>}
                              {!s.attendance && s.preferred_day !== dayName(date) && <span className="badge">Catch-up</span>}
                            </div>
                            <div className="text-xs text-slate-500 flex flex-wrap gap-x-2">
                              <span>{s.progress ? levelLabel({ name: s.progress.level_name ?? '' }) : s.levels?.name ?? '—'}</span>
                              <span>· current: Lesson {s.progress?.current_lesson_number ?? '—'}{s.progress?.next_lesson_number != null && ` · next: Lesson ${s.progress.next_lesson_number}`}</span>
                              <SubscriptionBadge subscriptionId={s.subscription_id} />
                            </div>
                          </div>
                        </div>
                      </div>

                      <SessionEntryRow
                        student={s}
                        date={date}
                        dayLabel={dayName(date)}
                        levels={levels}
                        lessons={lessons}
                        attendance={s.attendance}
                        sessionsToday={s.sessionsToday}
                        feedbackBySessionId={sessionFeedbackMap}
                        previouslyCompleted={s.previouslyCompleted}
                        onChanged={() => void loadRoster(date)}
                      />

                      {s.progress && s.progress.current_kind !== 'normal' && s.progress.current_kind !== 'complete' && (
                        <AssessmentPanel
                          studentId={s.id}
                          studentName={s.full_name}
                          pendingAssessmentPointId={s.pending_assessment_point_id}
                          focusTopic={s.progress.focus_topic ?? null}
                          plan={s.plan}
                          sessionId={s.sessionsToday.length ? s.sessionsToday[s.sessionsToday.length - 1].id : null}
                          onDone={() => void loadRoster(date)}
                          compact
                        />
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {showAdd && (
        <AddToRegister
          date={date}
          dayLabel={dayName(date)}
          excludeIds={new Set(roster.map((r) => r.id))}
          onAdded={() => {
            setShowAdd(false)
            void loadRoster(date)
          }}
          onClose={() => setShowAdd(false)}
        />
      )}

      {(bulkModal === 'attended' || bulkModal === 'absent') && (
        <BulkAttendanceModal
          target={bulkModal === 'attended' ? 'Arrived' : 'Absent'}
          candidates={attendanceCandidates}
          date={date}
          dayLabel={dayName(date)}
          onDone={() => {
            setBulkModal(null)
            setSelected(new Set())
            void loadRoster(date)
          }}
          onClose={() => setBulkModal(null)}
        />
      )}

      {(bulkModal === 'lesson_outcome' || bulkModal === 'not_finished') && (
        <BulkSessionModal
          mode={bulkModal}
          candidates={sessionCandidates}
          date={date}
          levels={levels}
          lessons={lessons}
          onDone={() => {
            setBulkModal(null)
            setSelected(new Set())
            void loadRoster(date)
          }}
          onClose={() => setBulkModal(null)}
        />
      )}

      {bulkModal === 'feedback' && (
        <BulkFeedbackModal
          candidates={feedbackCandidates}
          onDone={() => {
            setBulkModal(null)
            setSelected(new Set())
            void loadRoster(date)
          }}
          onClose={() => setBulkModal(null)}
        />
      )}
    </div>
  )
}

