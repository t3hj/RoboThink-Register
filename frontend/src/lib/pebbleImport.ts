// Reads a Pebble "activity register" spreadsheet and plans which students to
// create or update. Pure functions only (no network), so it is easy to test.
//
// PRIVACY: only the columns in USED_COLUMNS are ever read. Everything else
// Pebble includes (medical, SEN, photo permission, marketing opt-in, customer
// name, year group, ...) is deliberately ignored and never leaves the browser.

import { dayName } from './dates'

export const USED_COLUMNS = ['child', 'dob', 'ticket', 'mobile', 'email'] as const

export interface PebbleMeta {
  activity: string | null
  className: string | null
  /** ISO date of the exported session. */
  date: string | null
  /** 'HH:MM' start time of the session. */
  time: string | null
}

export interface PebbleRow {
  rowNumber: number
  name: string
  dob: string | null
  ticket: string | null
  mobile: string | null
  email: string | null
  warnings: string[]
}

export interface PebbleParseResult {
  meta: PebbleMeta
  rows: PebbleRow[]
  /** Column headings present in the file that are NOT imported. */
  ignoredColumns: string[]
  error: string | null
}

const text = (cell: unknown): string => {
  if (cell === null || cell === undefined) return ''
  if (cell instanceof Date) return isoFromDate(cell)
  return String(cell).replace(/\s+/g, ' ').trim()
}

function isoFromDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Accepts dd/mm/yyyy (UK), yyyy-mm-dd, or a Date. Returns ISO or null. */
export function parseUkDate(cell: unknown): string | null {
  if (cell instanceof Date && !Number.isNaN(cell.getTime())) return isoFromDate(cell)
  const s = text(cell)
  let y: number, m: number, d: number
  let match = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s)
  if (match) {
    d = Number(match[1]); m = Number(match[2]); y = Number(match[3])
  } else if ((match = /^(\d{4})-(\d{2})-(\d{2})/.exec(s))) {
    y = Number(match[1]); m = Number(match[2]); d = Number(match[3])
  } else return null
  const date = new Date(y, m - 1, d)
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) return null
  return isoFromDate(date)
}

function parseTime(cell: unknown): string | null {
  const m = /^(\d{1,2})[:.](\d{2})/.exec(text(cell))
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  return h < 24 && min < 60 ? `${String(h).padStart(2, '0')}:${m[2]}` : null
}

/** "sia solani shah " -> "Sia Solani Shah". Mixed-case names are left alone. */
export function cleanName(raw: unknown): string {
  const s = text(raw)
  if (!s) return ''
  if (s !== s.toLowerCase() && s !== s.toUpperCase()) return s
  return s.toLowerCase().replace(/(^|[\s'’-])(\p{L})/gu, (_m, sep: string, ch: string) => sep + ch.toUpperCase())
}

/** Key for matching the same child across files and against existing students. */
export const nameKey = (name: string): string => name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()

function cleanPhone(cell: unknown): string | null {
  let s = text(cell).replace(/[^\d+]/g, '')
  if (!s) return null
  if (/^7\d{9}$/.test(s)) s = '0' + s // Excel drops the leading zero from numeric cells
  if (s.startsWith('+44')) s = '0' + s.slice(3)
  return s.length >= 10 && s.length <= 13 ? s : null
}

function cleanEmail(cell: unknown): string | null {
  const s = text(cell).toLowerCase()
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) ? s : null
}

export function parsePebbleSheet(cells: unknown[][]): PebbleParseResult {
  const meta: PebbleMeta = { activity: null, className: null, date: null, time: null }
  const empty = (error: string): PebbleParseResult => ({ meta, rows: [], ignoredColumns: [], error })

  const headerIndex = cells.findIndex((row) => ['child', 'child name', 'student', 'name'].includes(text(row?.[0]).toLowerCase()))
  if (headerIndex < 0) return empty('This does not look like a Pebble register: I could not find the “child” column heading.')

  for (const row of cells.slice(0, headerIndex)) {
    const key = text(row?.[0]).toLowerCase()
    if (key === 'activity name') meta.activity = text(row[1]) || null
    else if (key === 'class') meta.className = text(row[1]) || null
    else if (key === 'date of session') meta.date = parseUkDate(row[1])
    else if (key === 'time of session') meta.time = parseTime(row[1])
  }

  const headers = cells[headerIndex].map((h) => text(h).toLowerCase())
  const col = (...names: string[]) => headers.findIndex((h) => names.includes(h))
  const idx = {
    name: col('child', 'child name', 'student', 'name'),
    dob: col('dob', 'date of birth'),
    ticket: col('ticket'),
    mobile: col('mobile', 'phone'),
    email: col('email'),
  }
  const used = new Set(Object.values(idx).filter((i) => i >= 0))
  const ignoredColumns = headers.filter((h, i) => h && !used.has(i))

  const rows: PebbleRow[] = []
  cells.slice(headerIndex + 1).forEach((cellRow, offset) => {
    const name = cleanName(cellRow?.[idx.name])
    if (!name) return
    const warnings: string[] = []
    const dobRaw = idx.dob >= 0 ? cellRow[idx.dob] : null
    let dob = dobRaw ? parseUkDate(dobRaw) : null
    if (dobRaw && !dob) warnings.push('Date of birth not understood, skipped')
    if (dob) {
      const age = (Date.now() - new Date(dob).getTime()) / (365.25 * 86_400_000)
      if (age < 2 || age > 25) {
        warnings.push('Date of birth looks wrong, skipped')
        dob = null
      }
    }
    const mobile = idx.mobile >= 0 ? cleanPhone(cellRow[idx.mobile]) : null
    const email = idx.email >= 0 ? cleanEmail(cellRow[idx.email]) : null
    if (idx.mobile >= 0 && text(cellRow[idx.mobile]) && !mobile) warnings.push('Mobile number not understood, skipped')
    if (idx.email >= 0 && text(cellRow[idx.email]) && !email) warnings.push('Email not understood, skipped')
    rows.push({
      rowNumber: headerIndex + offset + 2,
      name,
      dob,
      ticket: idx.ticket >= 0 ? text(cellRow[idx.ticket]) || null : null,
      mobile,
      email,
      warnings,
    })
  })

  if (rows.length === 0) return { meta, rows, ignoredColumns, error: 'The register has no students in it.' }
  return { meta, rows, ignoredColumns, error: null }
}

/** parent_contact is one text column: "mobile · email". */
export const contactFor = (row: Pick<PebbleRow, 'mobile' | 'email'>): string | null => [row.mobile, row.email].filter(Boolean).join(' · ') || null

export function suggestSubscriptionId(ticket: string | null, subscriptions: { id: number; name: string }[]): number | null {
  const t = (ticket ?? '').toLowerCase()
  const find = (needle: string) => subscriptions.find((s) => s.name.toLowerCase().includes(needle))?.id ?? null
  if (t.includes('term')) return find('term')
  if (t.includes('elite')) return find('elite')
  return null
}

// ---------------------------------------------------------------------------
// Matching against students already in the app
// ---------------------------------------------------------------------------

export interface ExistingStudent {
  id: string
  full_name: string
  date_of_birth: string | null
  parent_contact: string | null
  active: boolean
  attendance_pattern?: string | null
  slots: { day: string; time: string | null }[]
}

export type PlanAction = 'create' | 'add_session' | 'unchanged' | 'duplicate_in_file' | 'needs_attention'

export interface RowPlan {
  row: PebbleRow
  action: PlanAction
  existing?: ExistingStudent
  fillDob: boolean
  fillContact: boolean
  reason?: string
}

const sameSlot = (a: { day: string; time: string | null }, b: { day: string; time: string | null }) =>
  a.day === b.day && (a.time ?? '').slice(0, 5) === (b.time ?? '').slice(0, 5)

/** Decides, for each row, whether to create a student, add a session to an
 *  existing one, or leave it alone. Never overwrites existing details: DOB and
 *  contact are only filled where the student has none. */
export function planImport(rows: PebbleRow[], existing: ExistingStudent[], slot: { day: string; time: string | null } | null): RowPlan[] {
  const byName = new Map<string, ExistingStudent[]>()
  for (const s of existing) {
    const key = nameKey(s.full_name)
    byName.set(key, [...(byName.get(key) ?? []), s])
  }
  const seen = new Set<string>()

  return rows.map((row): RowPlan => {
    const key = nameKey(row.name)
    const fileKey = `${key}|${row.dob ?? ''}`
    if (seen.has(fileKey) || (!row.dob && [...seen].some((k) => k.startsWith(`${key}|`)))) {
      return { row, action: 'duplicate_in_file', fillDob: false, fillContact: false, reason: 'Appears twice in this file' }
    }
    seen.add(fileKey)

    // A different recorded date of birth means a different child with the same name.
    let candidates = (byName.get(key) ?? []).filter((s) => !(row.dob && s.date_of_birth && s.date_of_birth !== row.dob))
    if (candidates.length > 1 && row.dob) {
      const exact = candidates.filter((s) => s.date_of_birth === row.dob)
      if (exact.length === 1) candidates = exact
    }
    if (candidates.length > 1) {
      return { row, action: 'needs_attention', fillDob: false, fillContact: false, reason: 'Several students here share this name' }
    }
    if (candidates.length === 0) return { row, action: 'create', fillDob: false, fillContact: false }

    const match = candidates[0]
    if (!match.active) {
      return { row, action: 'needs_attention', existing: match, fillDob: false, fillContact: false, reason: 'Matches an inactive student, so left alone' }
    }
    const fillDob = Boolean(row.dob && !match.date_of_birth)
    const fillContact = Boolean(contactFor(row) && !match.parent_contact)
    const hasSlot = !slot || match.slots.some((s) => sameSlot(s, slot))
    return { row, action: hasSlot ? 'unchanged' : 'add_session', existing: match, fillDob, fillContact }
  })
}

/** Weekday + time for the exported session, e.g. 2026-10-20 15:15 -> Tuesday 15:15. */
export function sessionSlot(meta: PebbleMeta): { day: string; time: string | null } | null {
  return meta.date ? { day: dayName(meta.date), time: meta.time } : null
}
