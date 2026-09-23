interface Props {
  count: number
  onSelectAll: () => void
  onClear: () => void
  onMarkAttended: () => void
  onMarkAbsent: () => void
  onLessonOutcome: () => void
  onNotFinished: () => void
  onFeedback: () => void
}

/** Compact, touch-friendly selection bar — appears once at least one
 *  student is selected. All actions are always shown; eligibility within
 *  the current selection is worked out (and clearly explained) inside
 *  each action's own review step, not by disabling buttons here. */
export default function BulkActionBar({
  count,
  onSelectAll,
  onClear,
  onMarkAttended,
  onMarkAbsent,
  onLessonOutcome,
  onNotFinished,
  onFeedback,
}: Props) {
  return (
    <div className="sticky top-0 z-20 card p-3 mb-4 border-[color:var(--rt-blue)] flex flex-col gap-2" role="region" aria-label="Bulk actions">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <span className="font-medium text-sm">{count} student{count === 1 ? '' : 's'} selected</span>
        <div className="flex gap-2">
          <button className="text-xs text-slate-500 hover:underline" onClick={onSelectAll}>Select all</button>
          <button className="text-xs text-slate-500 hover:underline" onClick={onClear}>Clear</button>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <button className="btn-primary text-sm" onClick={onMarkAttended}>Mark Attended</button>
        <button className="btn-ghost text-sm" onClick={onMarkAbsent}>Mark Absent</button>
        <button className="btn-ghost text-sm" onClick={onLessonOutcome}>Lesson / Outcome</button>
        <button className="btn-ghost text-sm" onClick={onNotFinished}>Not Finished</button>
        <button className="btn-ghost text-sm" onClick={onFeedback}>Feedback</button>
      </div>
    </div>
  )
}
