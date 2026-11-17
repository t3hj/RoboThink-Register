import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import StudentProfile from '../src/pages/StudentProfile'
import { StatCard } from '../src/components/ui'

const backend = vi.hoisted(() => ({ tables: {} as Record<string, Record<string, unknown>[]> }))
vi.mock('../src/lib/auth', () => ({ useAuth: () => ({ role: 'instructor', profile: { id: 'staff' } }) }))
vi.mock('../src/lib/centres', () => ({ useCentres: () => ({ activeCentres: [] }) }))
vi.mock('../src/components/Toast', () => ({ useToast: () => ({ notify: vi.fn() }) }))
vi.mock('../src/lib/dates', async (original) => ({ ...await original<typeof import('../src/lib/dates')>(), todayISO: () => '2026-11-17' }))
vi.mock('../src/lib/curriculumData', () => ({ loadCurriculum: async () => ({ levels: [], lessons: [] }) }))
vi.mock('../src/components/StudentProjectsPanel', () => ({ default: () => null }))
vi.mock('../src/components/StartingLessonCard', () => ({ default: () => null }))
vi.mock('../src/components/AssessmentPanel', () => ({ default: () => null }))
vi.mock('../src/lib/supabaseClient', () => ({ supabase: { from: (table: string) => {
  let single = false; let start = 0; let end = Infinity
  const query = {
    select: () => query, eq: () => query, order: () => query, limit: () => query,
    maybeSingle: () => { single = true; return query },
    range: (from: number, to: number) => { start = from; end = to + 1; return query },
    then: (resolve: (value: unknown) => unknown) => {
      const rows = (backend.tables[table] ?? []).slice(start, end)
      return Promise.resolve(resolve({ data: single ? rows[0] ?? null : rows, error: null }))
    },
  }
  return query
} } }))

let renderer: ReactTestRenderer
const stat = (label: string) => renderer.root.findAllByType(StatCard).find((card) => card.props.label === label)!.props.value
async function mount() {
  await act(async () => { renderer = create(<MemoryRouter initialEntries={['/students/student']}><Routes><Route path="/students/:id" element={<StudentProfile />} /></Routes></MemoryRouter>) })
}
beforeEach(() => {
  backend.tables = {
    students: [{ id: 'student', full_name: 'Test Student', active: true, preferred_day: 'Sunday' }],
    lesson_records: [1, 2].map((number) => ({ id: `lesson-${number}`, lesson_number: number, date: '2026-11-08', status: 'completed' })),
    attendance: [
      { id: 'absent', date: '2026-11-01', status: 'Absent', session_type: 'regular' },
      { id: 'attended', date: '2026-11-08', status: 'Completed', session_type: 'regular' },
    ],
    attended_sessions: [{ id: 'session-1', date: '2026-11-08', session_number: 1 }],
  }
})
afterEach(async () => { if (renderer) await act(async () => renderer.unmount()) })

it('keeps two completed lessons separate from one recorded attendance session', async () => {
  await mount()
  expect(stat('Curriculum lessons completed')).toBe(2)
  expect(stat('Sessions attended')).toBe(1)
  expect(stat('Outstanding absences')).toBe(1)
  expect(stat('Attendance')).toBe('50%')
})

it('uses the second recorded session to make up an absence in both summary and history', async () => {
  backend.tables.attended_sessions.push({ id: 'session-2', date: '2026-11-08', session_number: 2 })
  await mount()
  expect(stat('Sessions attended')).toBe(2)
  expect(stat('Catch-up / extra sessions')).toBe(1)
  expect(stat('Absences made up')).toBe(1)
  expect(stat('Outstanding absences')).toBe(0)
  expect(stat('Attendance')).toBe('100%')
  const text = JSON.stringify(renderer.toJSON())
  expect(text).toContain('Made up')
  const historyRate = renderer.root.findAllByType('p').find((p) => JSON.stringify(p.children).includes('% attendance'))!
  expect(JSON.stringify(historyRate.children)).toContain('100')
})
