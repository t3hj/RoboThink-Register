import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Dashboard from '../src/pages/Dashboard'
import { StatCard } from '../src/components/ui'

type Row = Record<string, unknown>
type Filter = { method: string; column: string; value: unknown }
const backend = vi.hoisted(() => ({
  centreId: 'a' as string | null, loading: false, brand: 'robothink', isAllCentres: false,
  tables: {} as Record<string, Row[]>, calls: [] as { table: string; filters: Filter[] }[],
  delayedStudents: null as Promise<{ data: Row[]; error: null }> | null,
  failTable: null as string | null,
}))
vi.mock('../src/lib/auth', () => ({ useAuth: () => ({ role: 'admin', profile: { name: 'Test Staff' } }) }))
vi.mock('../src/lib/brand', () => ({ useBrand: () => ({ activeBrand: backend.brand }) }))
vi.mock('../src/lib/centres', () => ({ useCentres: () => ({ selectedCentreId: backend.centreId, selectedCentre: { name: `Centre ${backend.centreId}` }, isAllCentres: backend.isAllCentres, loading: backend.loading, error: null, refresh: vi.fn() }) }))
vi.mock('../src/lib/dates', async (original) => ({ ...await original<typeof import('../src/lib/dates')>(), todayISO: () => '2026-10-29' }))
vi.mock('../src/lib/supabaseClient', () => ({ supabase: { from: (table: string) => {
  const filters: Filter[] = []; let limit = Infinity; let head = false
  const delayed = table === 'students' ? backend.delayedStudents : null
  if (table === 'students') backend.delayedStudents = null
  const query: Record<string, unknown> = {
    select: (_columns: string, options?: { head?: boolean }) => { head = !!options?.head; return query },
    order: () => query,
    limit: (value: number) => { limit = value; return query },
    then: async (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => {
      backend.calls.push({ table, filters: [...filters] })
      try {
        if (backend.failTable === table) return resolve({ data: null, count: null, error: { message: 'Failed to fetch' } })
        const result = delayed ? await delayed : { data: backend.tables[table] ?? [], error: null }
        let data = result.data.filter((row) => filters.every(({ method, column, value }) => {
          if (method === 'eq') return row[column] === value
          if (method === 'neq') return row[column] !== value
          if (method === 'in') return (value as unknown[]).includes(row[column])
          if (method === 'gte') return String(row[column]) >= String(value)
          return String(row[column]) <= String(value)
        })).slice(0, limit)
        return resolve({ data: head ? null : data, count: data.length, error: result.error })
      } catch (error) { return reject(error) }
    },
  }
  for (const method of ['eq', 'neq', 'in', 'gte', 'lte']) query[method] = (column: string, value: unknown) => { filters.push({ method, column, value }); return query }
  return query
} } }))

let renderer: ReactTestRenderer
const page = () => <MemoryRouter><Dashboard /></MemoryRouter>
async function mount() { await act(async () => { renderer = create(page()) }) }
const statistic = (label: string) => renderer.root.findAllByType(StatCard).find((card) => card.props.label === label)!.props.value
const requestNotice = () => renderer.root.findAllByType('a').find((link) => link.props.href === '/requests')!.findAllByType('span').find((span) => span.props.className === 'font-semibold')!.children.join('')
beforeEach(() => {
  backend.centreId = 'a'; backend.brand = 'robothink'; backend.isAllCentres = false; backend.loading = false; backend.calls = []; backend.delayedStudents = null; backend.failTable = null
  const students = ['a', 'b', 'c'].map((id) => ({ id, full_name: `Student ${id.toUpperCase()}`, centre_id: id, brand: id === 'c' ? 'creative_iq' : 'robothink', active: true, preferred_day: 'Thursday', preferred_time: '16:00', current_lesson_id: 'lesson', date_joined: '2026-10-01', student_schedules: [] }))
  backend.tables = {
    students,
    attendance: students.map((s) => ({ student_id: s.id, centre_id: s.centre_id, date: '2026-10-29', status: s.id === 'b' ? 'Absent' : 'Arrived' })),
    student_progress: students.map((s) => ({ student_id: s.id, current_lesson_number: 1 })),
    lesson_records: students.map((s) => ({ id: `lesson-${s.id}`, student_id: s.id, status: 'completed', lesson_number: 1, date: '2026-10-29', levels: { name: 'JT1' } })),
    students_requiring_assessment_action: students.map((s) => ({ student_id: s.id, full_name: s.full_name, action: 'Review' })),
    feedback_sheets: [...students.map((s) => ({ id: `feedback-${s.id}`, student_id: s.id, status: 'not_written' })), { id: 'extra-b', student_id: 'b', status: 'not_written' }],
    student_requests: [...students.map((s) => ({ id: `request-${s.id}`, centre_id: s.centre_id, brand: s.brand, status: 'pending' })), { id: 'extra-b', centre_id: 'b', brand: 'robothink', status: 'pending' }],
  }
})
afterEach(async () => { if (renderer) await act(async () => renderer.unmount()) })

describe('dashboard working-centre scope', () => {
  it('scopes students, counts, history and follow-ups to the selected centre', async () => {
    await mount()
    expect(statistic('Expected today')).toBe(1)
    expect(statistic('Feedback outstanding')).toBe(1)
    expect(JSON.stringify(renderer.toJSON())).not.toContain('Student B')
    expect(JSON.stringify(renderer.toJSON())).not.toContain('Student C')
    expect(backend.calls.find((call) => call.table === 'students')!.filters).toContainEqual({ method: 'eq', column: 'centre_id', value: 'a' })
    for (const call of backend.calls.filter((call) => !['students', 'student_requests'].includes(call.table))) expect(call.filters).toContainEqual({ method: 'in', column: 'student_id', value: ['a'] })
    expect(backend.calls.find((call) => call.table === 'student_requests')!.filters).toContainEqual({ method: 'eq', column: 'centre_id', value: 'a' })
  })
  it('refreshes all figures when the centre changes', async () => {
    await mount()
    backend.centreId = 'b'
    await act(async () => renderer.update(page()))
    expect(statistic('Feedback outstanding')).toBe(2)
    expect(statistic('Absent')).toBe(1)
    expect(JSON.stringify(renderer.toJSON())).not.toContain('Student A')
    expect(requestNotice()).toBe('2 student requests')
  })
  it('combines centres in the active brand for All centres without mixing brands', async () => {
    backend.centreId = null; backend.isAllCentres = true
    await mount()
    expect(statistic('Expected today')).toBe(2)
    expect(statistic('Feedback outstanding')).toBe(3)
    expect(JSON.stringify(renderer.toJSON())).not.toContain('Student C')
    expect(JSON.stringify(renderer.toJSON())).toContain('All centres')
    expect(requestNotice()).toBe('3 student requests')
  })
  it('switches the entire scope with the active organisation', async () => {
    await mount()
    backend.centreId = 'c'; backend.brand = 'creative_iq'
    await act(async () => renderer.update(page()))
    expect(statistic('Expected today')).toBe(1)
    expect(statistic('Feedback outstanding')).toBe(1)
    expect(JSON.stringify(renderer.toJSON())).toContain('Student C')
    expect(JSON.stringify(renderer.toJSON())).not.toContain('Student A')
  })
  it('uses the attendance centre snapshot for today’s in-centre figure', async () => {
    backend.tables.attendance[0].centre_id = 'b'
    await mount()
    expect(statistic('Expected today')).toBe(1)
    expect(statistic('Attended today')).toBe(0)
  })
  it('does not treat an unassigned instructor as All centres', async () => {
    backend.centreId = null
    await mount()
    expect(backend.calls).toHaveLength(0)
    expect(renderer.root.findAllByType(StatCard)).toHaveLength(0)
    expect(JSON.stringify(renderer.toJSON())).toContain('No working centre available')
  })
  it('does not issue unfiltered student-owned reads for an empty centre', async () => {
    backend.centreId = 'empty'
    await mount()
    expect(statistic('Expected today')).toBe(0)
    expect(statistic('Feedback outstanding')).toBe(0)
    expect(backend.calls.every((call) => ['students', 'student_requests'].includes(call.table))).toBe(true)
  })
  it('waits for centre assignments before fetching figures', async () => {
    backend.loading = true
    await mount()
    expect(backend.calls).toHaveLength(0)
    backend.loading = false
    await act(async () => renderer.update(page()))
    expect(statistic('Expected today')).toBe(1)
  })
  it('ignores late results from the previous centre', async () => {
    let resolve!: (value: { data: Row[]; error: null }) => void
    backend.delayedStudents = new Promise((done) => { resolve = done })
    await mount()
    backend.centreId = 'b'
    await act(async () => renderer.update(page()))
    expect(statistic('Feedback outstanding')).toBe(2)
    await act(async () => resolve({ data: backend.tables.students, error: null }))
    expect(statistic('Feedback outstanding')).toBe(2)
    expect(JSON.stringify(renderer.toJSON())).not.toContain('Student A')
  })
  it('shows a retryable error rather than treating a failed request count as zero', async () => {
    backend.failTable = 'student_requests'
    await mount()
    expect(renderer.root.findAllByType(StatCard)).toHaveLength(0)
    expect(renderer.root.findAllByProps({ role: 'alert' })).toHaveLength(1)
    backend.failTable = null
    await act(async () => renderer.root.findAllByType('button').find((button) => button.children.includes('Try again'))!.props.onClick())
    expect(statistic('Expected today')).toBe(1)
  })
})

const upcomingStudentLinks = () => renderer.root.findByProps({ 'aria-labelledby': 'upcoming-heading' }).findAllByType('a').map((link) => link.props.href)
function footerCount(label: string) {
  const labelNode = renderer.root.findAllByType('div').find((node) => node.children.includes(label))!
  return labelNode.parent!.findByProps({ className: 'text-xl font-bold' }).children.join('')
}
function savedProject() {
  backend.tables.attended_sessions = [{ student_id: 'a', centre_id: 'a', date: '2026-10-29', actual_lesson_id: null, project_id: 'project-a', outcome: 'not_finished' }]
}
describe('dashboard arrivals versus session outcomes', () => {
  it('counts Not Arrived records as unmarked and still upcoming', async () => {
    backend.tables.attendance[0].status = 'Not Arrived'
    await mount()
    expect(footerCount('Awaiting register mark')).toBe('1')
    expect(upcomingStudentLinks()).toContain('/students/a')
    expect(statistic('Attended today')).toBe(0)
  })
  it('does not show an arrived student as upcoming when their project was not finished', async () => {
    savedProject()
    await mount()
    expect(upcomingStudentLinks()).not.toContain('/students/a')
    expect(statistic('Attended today')).toBe(1)
    expect(footerCount('Sessions recorded today')).toBe('1')
    expect(footerCount('Awaiting register mark')).toBe('0')
    expect(renderer.root.findAllByProps({ 'aria-label': 'Register entries to finish' })).toHaveLength(0)
    expect(backend.tables.attended_sessions[0].outcome).toBe('not_finished')
  })
  it('separates missing session details from outstanding arrivals', async () => {
    await mount()
    expect(upcomingStudentLinks()).not.toContain('/students/a')
    expect(renderer.root.findAllByProps({ 'aria-label': 'Register entries to finish' })).toHaveLength(1)
    expect(JSON.stringify(renderer.toJSON())).toContain('Session details not recorded')
    expect(footerCount('Awaiting register mark')).toBe('0')
  })
  it('flags a saved session with missing attendance without claiming the student has not arrived', async () => {
    savedProject()
    backend.tables.attendance[0].status = 'Not Arrived'
    await mount()
    expect(upcomingStudentLinks()).not.toContain('/students/a')
    expect(footerCount('Awaiting register mark')).toBe('1')
    expect(JSON.stringify(renderer.toJSON())).toContain('Session recorded — attendance mark still needed')
  })
  it('includes a saved catch-up session even if its attendance update failed', async () => {
    savedProject()
    backend.tables.students[0].preferred_day = 'Friday'
    backend.tables.attendance = backend.tables.attendance.filter((row) => row.student_id !== 'a')
    await mount()
    expect(statistic('Expected today')).toBe(1)
    expect(upcomingStudentLinks()).not.toContain('/students/a')
    expect(JSON.stringify(renderer.toJSON())).toContain('Session recorded — attendance mark still needed')
  })
  it('counts completed attendance as attended rather than upcoming', async () => {
    savedProject()
    backend.tables.attendance[0].status = 'Completed'
    await mount()
    expect(statistic('Attended today')).toBe(1)
    expect(upcomingStudentLinks()).not.toContain('/students/a')
  })
  it('does not guess session completeness when today’s session read fails', async () => {
    backend.failTable = 'attended_sessions'
    await mount()
    expect(renderer.root.findAllByType(StatCard)).toHaveLength(0)
    expect(renderer.root.findAllByProps({ role: 'alert' })).toHaveLength(1)
  })
})
