import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import type { TermTimeFollowupStatus } from '../types'
import type { TermTimeEntry } from '../lib/managementAnalytics'
import { formatShortDate } from '../lib/dates'

export const FOLLOWUP_OPTIONS: { value: TermTimeFollowupStatus; label: string }[] = [
  { value: 'needs_follow_up', label: 'Needs follow-up' },
  { value: 'contacted', label: 'Contacted · awaiting reply' },
  { value: 'extended', label: 'Renewed / extended' },
  { value: 'not_continuing', label: 'Not continuing' },
  { value: 'snoozed', label: 'Follow up later' },
]
export interface FollowupUpdate {
  status: TermTimeFollowupStatus
  notes: string | null
  next_follow_up_date: string | null
}

function FollowupRow({
  entry,
  editable,
  today,
  onSave,
}: {
  entry: TermTimeEntry
  editable: boolean
  today: string
  onSave: (entry: TermTimeEntry, update: FollowupUpdate) => Promise<boolean>
}) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<TermTimeFollowupStatus>(entry.record?.status ?? 'needs_follow_up')
  const [notes, setNotes] = useState(entry.record?.notes ?? '')
  const [date, setDate] = useState(entry.record?.next_follow_up_date ?? '')
  const [error, setError] = useState('')
  useEffect(() => {
    setStatus(entry.record?.status ?? 'needs_follow_up')
    setNotes(entry.record?.notes ?? '')
    setDate(entry.record?.next_follow_up_date ?? '')
  }, [entry.record])
  const overdue =
    entry.record?.next_follow_up_date &&
    entry.record.next_follow_up_date < today &&
    !['extended', 'not_continuing'].includes(entry.record.status)
  async function save() {
    if (status === 'snoozed' && !date) {
      setError('Choose a date to follow up later.')
      return
    }
    setBusy(true)
    setError('')
    const saved = await onSave(entry, { status, notes: notes.trim() || null, next_follow_up_date: date || null })
    setBusy(false)
    if (saved) setOpen(false)
    else setError('Could not save this follow-up. Your changes are still here; try again.')
  }
  return (
    <li className="py-3 text-sm">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <Link to={`/students/${entry.student.id}`} className="font-medium hover:underline">
            {entry.student.full_name}
          </Link>
          <span className="text-slate-600">
            {' '}
            · {entry.attended}/12 attended · block {entry.block}
          </span>
          <p className="text-xs text-slate-600 mt-1">
            {entry.dueDate
              ? `Reached 12 sessions on ${formatShortDate(entry.dueDate)}`
              : `${12 - entry.attended} sessions until follow-up`}{' '}
            · {entry.totalAttended} attended in recorded history
          </p>
          {entry.dueDate && (
            <p className="text-xs mt-1">
              {FOLLOWUP_OPTIONS.find((option) => option.value === (entry.record?.status ?? 'needs_follow_up'))?.label}
              {entry.record?.next_follow_up_date
                ? ` · next contact ${formatShortDate(entry.record.next_follow_up_date)}`
                : ''}
              {overdue ? ' · Overdue' : ''}
            </p>
          )}
          {entry.record?.notes && (
            <p className="text-xs text-slate-600 mt-1 whitespace-pre-wrap">{entry.record.notes}</p>
          )}
        </div>
        {editable && entry.dueDate && (
          <button className="btn-ghost text-xs" onClick={() => setOpen(!open)} disabled={busy}>
            {open ? 'Cancel' : 'Update follow-up'}
          </button>
        )}
      </div>
      {open && (
        <div className="mt-3 grid sm:grid-cols-2 gap-3 rounded-lg bg-slate-50 p-3">
          <label className="text-xs">
            Status
            <select
              className="mt-1 w-full border rounded-lg p-2"
              value={status}
              onChange={(event) => setStatus(event.target.value as TermTimeFollowupStatus)}
              disabled={busy}
            >
              {FOLLOWUP_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs">
            Next follow-up date
            <input
              type="date"
              className="mt-1 w-full border rounded-lg p-2"
              value={date}
              onChange={(event) => setDate(event.target.value)}
              disabled={busy}
            />
          </label>
          <label className="text-xs sm:col-span-2">
            Notes
            <textarea
              className="mt-1 w-full border rounded-lg p-2"
              rows={2}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              disabled={busy}
            />
          </label>
          {error && (
            <p role="alert" className="text-xs text-rose-700 sm:col-span-2">
              {error}
            </p>
          )}
          <button className="btn-primary justify-self-start text-xs" onClick={() => void save()} disabled={busy}>
            {busy ? 'Saving…' : 'Save follow-up'}
          </button>
        </div>
      )}
    </li>
  )
}

export default function TermTimeFollowupsPanel({
  entries,
  editable,
  today,
  onSave,
}: {
  entries: TermTimeEntry[]
  editable: boolean
  today: string
  onSave: (entry: TermTimeEntry, update: FollowupUpdate) => Promise<boolean>
}) {
  const [showClosed, setShowClosed] = useState(false)
  const open = entries.filter((entry) => !entry.record || !['extended', 'not_continuing'].includes(entry.record.status))
  const visible = (showClosed ? entries : open).toSorted((a, b) => {
    const priority = (entry: TermTimeEntry) =>
      entry.record?.next_follow_up_date &&
      entry.record.next_follow_up_date < today &&
      !['extended', 'not_continuing'].includes(entry.record.status)
        ? 0
        : !entry.dueDate
          ? 3
          : !entry.record || entry.record.status === 'needs_follow_up'
            ? 1
            : 2
    return (
      priority(a) - priority(b) ||
      (a.dueDate ?? '').localeCompare(b.dueDate ?? '') ||
      a.student.full_name.localeCompare(b.student.full_name)
    )
  })
  return (
    <section id="term-time-followups" className="card p-4 scroll-mt-4">
      <div className="flex items-center justify-between gap-3 flex-wrap mb-2">
        <h2 className="font-semibold">Term-time follow-ups</h2>
        <label className="text-xs flex items-center gap-2">
          <input type="checkbox" checked={showClosed} onChange={(event) => setShowClosed(event.target.checked)} />{' '}
          Include resolved
        </label>
      </div>
      <p className="text-xs text-slate-600 mb-2">
        Follow up after each 12 attended sessions. Early warning starts at 10. Absences do not use sessions; attended
        catch-ups, assessments, projects and unfinished sessions do. Counts use the available attendance history.
      </p>
      {visible.length ? (
        <ul className="divide-y divide-slate-100">
          {visible.map((entry) => (
            <FollowupRow
              key={`${entry.student.id}-${entry.block}`}
              entry={entry}
              editable={editable}
              today={today}
              onSave={onSave}
            />
          ))}
        </ul>
      ) : (
        <p className="text-sm text-slate-600 py-3">No term-time students approaching or awaiting follow-up.</p>
      )}
    </section>
  )
}
