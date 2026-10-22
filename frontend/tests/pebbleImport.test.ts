import { describe, expect, it } from 'vitest'
import { cleanName, contactFor, nameKey, parsePebbleSheet, parseUkDate, planImport, sessionSlot, suggestSubscriptionId, type ExistingStudent } from '../src/lib/pebbleImport'

// All names, numbers and emails below are invented.
const HEADERS = ['child', 'dob', 'medical', 'photo', 'attendance', 'ticket', 'customer', 'mobile', 'SEN', 'Year/Class', 'email', 'supplier_marketing_optin']
const sheet = (rows: unknown[][]): unknown[][] => [
  ['Activity Name', 'Robot Club @ Example School'],
  ['Class', 'Autumn Term 2026'],
  ['Location', 'Somewhere'],
  ['Date of session', '20/10/2026'],
  ['Time of session', '15:15'],
  ['Session Status', 'confirmed'],
  [],
  [],
  HEADERS,
  ...rows,
]
const row = (name: string, dob: string, ticket: string, mobile: string, email: string) => [name, dob, 'SECRET MEDICAL', 'YES', 'Attended', ticket, 'Parent Name', mobile, 'SECRET SEN', 'Y5', email, 'True']

describe('parsePebbleSheet', () => {
  const parsed = parsePebbleSheet(sheet([row('Ada Example ', '05/08/2016', 'Full Term Ticket', '07700900001', 'ADA.PARENT@example.com'), row('ben test', '13/04/2017', 'Full Term Ticket', '7700900002', 'not-an-email')]))

  it('reads the session details from the header block', () => {
    expect(parsed.error).toBeNull()
    expect(parsed.meta).toMatchObject({ activity: 'Robot Club @ Example School', date: '2026-10-20', time: '15:15' })
    expect(sessionSlot(parsed.meta)).toEqual({ day: 'Tuesday', time: '15:15' })
  })

  it('cleans names, dates, phones and emails', () => {
    expect(parsed.rows[0]).toMatchObject({ name: 'Ada Example', dob: '2016-08-05', mobile: '07700900001', email: 'ada.parent@example.com' })
    expect(parsed.rows[1]).toMatchObject({ name: 'Ben Test', mobile: '07700900002', email: null })
    expect(parsed.rows[1].warnings).toContain('Email not understood, skipped')
  })

  it('never carries sensitive columns through, and reports them as ignored', () => {
    expect(JSON.stringify(parsed.rows)).not.toMatch(/SECRET|Parent Name|Y5/)
    expect(parsed.ignoredColumns).toEqual(expect.arrayContaining(['medical', 'sen', 'photo', 'customer', 'supplier_marketing_optin']))
    expect(parsed.ignoredColumns).not.toContain('child')
    expect(parsed.ignoredColumns).not.toContain('dob')
  })

  it('rejects a file that is not a Pebble register', () => {
    expect(parsePebbleSheet([['a', 'b'], ['c', 'd']]).error).toMatch(/child/)
    expect(parsePebbleSheet(sheet([])).error).toMatch(/no students/)
  })

  it('skips blank rows and drops implausible birth dates', () => {
    const p = parsePebbleSheet(sheet([[], row('Cy Example', '01/01/1900', 'Full Term Ticket', '07700900003', 'cy@example.com')]))
    expect(p.rows).toHaveLength(1)
    expect(p.rows[0].dob).toBeNull()
    expect(p.rows[0].warnings.join()).toMatch(/Date of birth/)
  })
})

describe('helpers', () => {
  it('parses UK dates strictly', () => {
    expect(parseUkDate('5/8/2016')).toBe('2016-08-05')
    expect(parseUkDate('31/02/2016')).toBeNull()
    expect(parseUkDate('2016-08-05')).toBe('2016-08-05')
    expect(parseUkDate(new Date(2016, 7, 5))).toBe('2016-08-05')
  })
  it('title-cases only names that are all upper or all lower', () => {
    expect(cleanName('sia solani shah ')).toBe('Sia Solani Shah')
    expect(cleanName('MARY-ANN O’NEIL')).toBe('Mary-Ann O’Neil')
    expect(cleanName('Aaryan Mehta-Sheth')).toBe('Aaryan Mehta-Sheth')
    expect(cleanName('McDonald')).toBe('McDonald')
  })
  it('builds a contact string and matching key', () => {
    expect(contactFor({ mobile: '07700900001', email: 'a@b.co' })).toBe('07700900001 · a@b.co')
    expect(contactFor({ mobile: null, email: null })).toBeNull()
    expect(nameKey("  Mary-Ann  O'Neil ")).toBe('mary ann o neil')
  })
  it('suggests a subscription from the ticket name', () => {
    const subs = [{ id: 1, name: 'Elite' }, { id: 2, name: 'Term Time' }]
    expect(suggestSubscriptionId('Full Term Ticket', subs)).toBe(2)
    expect(suggestSubscriptionId('Elite Monthly', subs)).toBe(1)
    expect(suggestSubscriptionId('Mystery', subs)).toBeNull()
    expect(suggestSubscriptionId(null, subs)).toBeNull()
  })
})

describe('planImport', () => {
  const slot = { day: 'Tuesday', time: '15:15' }
  const student = (over: Partial<ExistingStudent> & { full_name: string }): ExistingStudent => ({
    id: over.full_name, date_of_birth: null, parent_contact: null, active: true, slots: [], ...over,
  })
  const r = (name: string, dob: string | null = null) => ({ rowNumber: 1, name, dob, ticket: null, mobile: '07700900001', email: null, warnings: [] })

  it('creates students that do not exist yet', () => {
    expect(planImport([r('New Kid')], [], slot)[0].action).toBe('create')
  })

  it('adds a session to an existing student instead of duplicating them', () => {
    const plan = planImport([r('Ada Example')], [student({ full_name: 'ada  example', slots: [{ day: 'Saturday', time: '10:00:00' }] })], slot)[0]
    expect(plan.action).toBe('add_session')
    expect(plan.existing?.id).toBe('ada  example')
  })

  it('leaves an up-to-date student alone but fills missing details', () => {
    const plan = planImport([r('Ada Example', '2016-08-05')], [student({ full_name: 'Ada Example', slots: [{ day: 'Tuesday', time: '15:15:00' }] })], slot)[0]
    expect(plan.action).toBe('unchanged')
    expect(plan.fillDob).toBe(true)
    expect(plan.fillContact).toBe(true)
  })

  it('never overwrites details that are already stored', () => {
    const plan = planImport([r('Ada Example', '2016-08-05')], [student({ full_name: 'Ada Example', date_of_birth: '2016-08-05', parent_contact: 'old', slots: [{ day: 'Tuesday', time: '15:15' }] })], slot)[0]
    expect(plan.fillDob).toBe(false)
    expect(plan.fillContact).toBe(false)
  })

  it('treats a different birth date as a different child', () => {
    const plan = planImport([r('Sam Smith', '2015-01-01')], [student({ full_name: 'Sam Smith', date_of_birth: '2016-06-06' })], slot)[0]
    expect(plan.action).toBe('create')
  })

  it('asks for help when names are ambiguous or the match is inactive', () => {
    expect(planImport([r('Sam Smith')], [student({ full_name: 'Sam Smith', id: '1' }), student({ full_name: 'Sam Smith', id: '2' })], slot)[0].action).toBe('needs_attention')
    expect(planImport([r('Old Pupil')], [student({ full_name: 'Old Pupil', active: false })], slot)[0].action).toBe('needs_attention')
  })

  it('flags a child listed twice in the same file', () => {
    const plans = planImport([r('Twin Name', '2016-01-01'), r('Twin Name', '2016-01-01')], [], slot)
    expect(plans.map((p) => p.action)).toEqual(['create', 'duplicate_in_file'])
  })

  it('same name with different birth dates in one file are two children', () => {
    const plans = planImport([r('Sam Smith', '2016-01-01'), r('Sam Smith', '2015-05-05')], [], slot)
    expect(plans.map((p) => p.action)).toEqual(['create', 'create'])
  })
})
