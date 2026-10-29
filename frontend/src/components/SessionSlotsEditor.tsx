export const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

export interface SlotInput {
  day: string
  time: string
}

interface Props {
  slots: SlotInput[]
  onChange: (slots: SlotInput[]) => void
  disabled?: boolean
}

const MAX_SLOTS = 4

/** Day + time rows for a student's weekly sessions. The first row is their
 *  main session; extra rows are additional sessions (for example a student
 *  who comes on both Saturday and Sunday). */
export default function SessionSlotsEditor({ slots, onChange, disabled }: Props) {
  const update = (index: number, patch: Partial<SlotInput>) => onChange(slots.map((s, i) => (i === index ? { ...s, ...patch } : s)))
  return (
    <fieldset className="space-y-2" disabled={disabled}>
      <legend className="text-sm text-slate-600 mb-1">Weekly sessions</legend>
      {slots.map((slot, index) => (
        <div key={index} className="grid grid-cols-[1fr_auto_auto] gap-2 items-center">
          <select
            aria-label={`Session ${index + 1} day`}
            className="w-full p-2 border border-slate-200 rounded-lg text-sm"
            value={slot.day}
            onChange={(e) => update(index, { day: e.target.value })}
          >
            <option value="">Day…</option>
            {DAYS.map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
          <input
            type="time"
            aria-label={`Session ${index + 1} time`}
            className="p-2 border border-slate-200 rounded-lg text-sm"
            value={slot.time}
            onChange={(e) => update(index, { time: e.target.value })}
          />
          {slots.length > 1 ? (
            <button type="button" className="btn-ghost text-xs" onClick={() => onChange(slots.filter((_, i) => i !== index))} aria-label={`Remove session ${index + 1}`}>
              Remove
            </button>
          ) : (
            <span />
          )}
        </div>
      ))}
      {slots.length < MAX_SLOTS && (
        <button type="button" className="btn-ghost text-xs" onClick={() => onChange([...slots, { day: '', time: '' }])}>
          + Add another session
        </button>
      )}
    </fieldset>
  )
}

/** Sessions that have both a day and a time, without exact duplicates. */
export function validSlots(slots: SlotInput[]): SlotInput[] {
  const seen = new Set<string>()
  return slots.filter((s) => {
    if (!s.day || !s.time) return false
    const key = `${s.day}|${s.time}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/** Initial rows for a student: their schedule rows, else their single day/time, else one empty row. */
export function initialSlots(student?: { preferred_day?: string | null; preferred_time?: string | null; student_schedules?: { day_of_week: string; start_time: string; active?: boolean }[] | null } | null): SlotInput[] {
  const rows = (student?.student_schedules ?? []).filter((r) => r.active !== false)
  if (rows.length > 0) {
    const order = (d: string) => DAYS.indexOf(d)
    return [...rows].sort((a, b) => order(a.day_of_week) - order(b.day_of_week)).map((r) => ({ day: r.day_of_week, time: r.start_time.slice(0, 5) }))
  }
  if (student?.preferred_day) return [{ day: student.preferred_day, time: (student.preferred_time ?? '').slice(0, 5) }]
  return [{ day: '', time: '' }]
}
