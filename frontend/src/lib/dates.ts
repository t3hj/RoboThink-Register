// UK-local date helpers.
// Never use toISOString().slice(0,10) for "today" — it returns UTC and will be
// wrong in the UK evening during GMT (and any time the local date differs from UTC).

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const

/** Format a Date as a YYYY-MM-DD string in the machine's LOCAL timezone (UK). */
export function toLocalISODate(d: Date = new Date()): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** Today's date as YYYY-MM-DD in local (UK) time. */
export function todayISO(): string {
  return toLocalISODate(new Date())
}

/** Parse a YYYY-MM-DD string as a *local* Date (avoids UTC parsing pitfalls). */
export function parseISODate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, (m ?? 1) - 1, d ?? 1)
}

/** Day name (e.g. 'Tuesday') for a YYYY-MM-DD string, evaluated in local time. */
export function dayName(iso: string): string {
  return DAYS[parseISODate(iso).getDay()]
}

/** 'Monday' → 1, matching Date.getDay(). */
export function dayIndex(name: string): number {
  return DAYS.findIndex((d) => d.toLowerCase() === name.toLowerCase())
}

/** Current local time as HH:MM (24h). */
export function nowHM(): string {
  const d = new Date()
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** e.g. 'Tue 9 Sep 2025'. */
export function formatDisplayDate(iso: string): string {
  return parseISODate(iso).toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

/** e.g. '9 Sep'. */
export function formatShortDate(iso: string): string {
  return parseISODate(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

/** Offset a YYYY-MM-DD date by n days, returning YYYY-MM-DD (local). */
export function addDays(iso: string, n: number): string {
  const d = parseISODate(iso)
  d.setDate(d.getDate() + n)
  return toLocalISODate(d)
}
