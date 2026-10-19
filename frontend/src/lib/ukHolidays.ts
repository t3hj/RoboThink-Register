// England & Wales bank holidays. The centres are closed on these days (and
// on Christmas), so nobody is "expected" and nothing is flagged as unmarked.
// Computed rather than listed so it never needs a yearly update. One-off
// closures (e.g. a royal occasion) can be added to EXTRA_CLOSED_DATES.

export const EXTRA_CLOSED_DATES: Record<string, string> = {
  // 'YYYY-MM-DD': 'Reason shown on the register',
}

const iso = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`

/** Western Easter Sunday (Anonymous Gregorian algorithm). */
function easterSunday(year: number): Date {
  const a = year % 19
  const b = Math.floor(year / 100)
  const c = year % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const month = Math.floor((h + l - 7 * m + 114) / 31)
  const day = ((h + l - 7 * m + 114) % 31) + 1
  return new Date(year, month - 1, day)
}

function shift(date: Date, days: number): Date {
  const d = new Date(date)
  d.setDate(d.getDate() + days)
  return d
}

const fmt = (d: Date) => iso(d.getFullYear(), d.getMonth() + 1, d.getDate())

/** n-th (1-based) Monday of a month, or the last Monday when n = -1. */
function mondayOf(year: number, month: number, n: number): Date {
  if (n > 0) {
    const first = new Date(year, month - 1, 1)
    return new Date(year, month - 1, 1 + ((8 - first.getDay()) % 7) + (n - 1) * 7)
  }
  const last = new Date(year, month, 0)
  return new Date(year, month - 1, last.getDate() - ((last.getDay() + 6) % 7))
}

/** Move a weekend date to the following weekday per the substitute-day rules. */
function substitute(date: Date, sundayShift: number): Date {
  if (date.getDay() === 6) return shift(date, 2)
  if (date.getDay() === 0) return shift(date, sundayShift)
  return date
}

const cache = new Map<number, Map<string, string>>()

function holidaysFor(year: number): Map<string, string> {
  const cached = cache.get(year)
  if (cached) return cached
  const easter = easterSunday(year)
  const christmas = new Date(year, 11, 25)
  const boxing = new Date(year, 11, 26)
  const list: [Date, string][] = [
    [substitute(new Date(year, 0, 1), 1), "New Year's Day"],
    [shift(easter, -2), 'Good Friday'],
    [shift(easter, 1), 'Easter Monday'],
    [mondayOf(year, 5, 1), 'Early May bank holiday'],
    [mondayOf(year, 5, -1), 'Spring bank holiday'],
    [mondayOf(year, 8, -1), 'Summer bank holiday'],
    // Christmas Day falling on Sat/Sun moves to the next free weekday, and
    // Boxing Day follows it (Sat 26th -> Mon 28th, Sun 26th -> Tue 28th).
    [christmas.getDay() === 6 ? shift(christmas, 2) : christmas.getDay() === 0 ? shift(christmas, 2) : christmas, 'Christmas Day'],
    [boxing.getDay() === 6 ? shift(boxing, 2) : boxing.getDay() === 0 ? shift(boxing, 2) : boxing, 'Boxing Day'],
  ]
  const map = new Map(list.map(([d, name]) => [fmt(d), name]))
  cache.set(year, map)
  return map
}

/** Name of the closure on this YYYY-MM-DD date, or null if the centres are open. */
export function closureName(date: string): string | null {
  const year = Number(date.slice(0, 4))
  return EXTRA_CLOSED_DATES[date] ?? holidaysFor(year).get(date) ?? holidaysFor(year + 1).get(date) ?? null
}

export const isClosedDay = (date: string): boolean => closureName(date) !== null
