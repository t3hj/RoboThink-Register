import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { useState } from 'react'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import Register from '../src/pages/Register'

const database = vi.hoisted(() => ({
  centreId: 'centre-a',
  attendance: [] as unknown[],
  nextStudents: null as Promise<{ data: unknown[] | null; error: { message: string } | null }> | null,
}))
vi.mock('../src/lib/centres', () => ({ useCentres: () => ({ selectedCentreId: database.centreId, selectedCentre: { name: 'Test centre' }, isAllCentres: false }) }))
vi.mock('../src/lib/curriculumData', () => ({ loadCurriculum: async () => ({ levels: [], lessons: [] }) }))
vi.mock('../src/lib/supabaseClient', () => ({
  supabase: { from: (table: string) => {
    const pending = table === 'students' ? database.nextStudents : null
    if (table === 'students') database.nextStudents = null
    const result = pending ?? Promise.resolve({ data: table === 'students' ? ['A', 'B'].map((id) => ({ id, full_name: `Student ${id}`, active: true, preferred_day: 'Thursday', preferred_time: '16:00', student_schedules: [] })) : table === 'attendance' ? database.attendance : [], error: null })
    const query: Record<string, unknown> = { then: result.then.bind(result) }
    for (const method of ['select', 'eq', 'in', 'neq', 'order', 'or']) query[method] = () => query
    return query
  } },
}))
// A stateful row makes losing component identity observable. Database writes
// are outside this test: saving A should never destroy B's local form state.
vi.mock('../src/components/SessionEntryRow', () => ({ default: ({ student, onChanged }: { student: { id: string }; onChanged: () => void }) => {
  const [draft, setDraft] = useState('')
  return <div><input aria-label={`Draft ${student.id}`} value={draft} onChange={(e) => setDraft(e.target.value)} /><button aria-label={`Save ${student.id}`} onClick={onChanged}>Save</button></div>
} }))
vi.mock('../src/components/LessonsToday', () => ({ default: () => null }))
vi.mock('../src/components/AssessmentPanel', () => ({ default: () => null }))

let renderer: ReactTestRenderer
const renderPage = () => <MemoryRouter initialEntries={['/register?date=2026-10-29']}><Register /></MemoryRouter>
async function mount() { await act(async () => { renderer = create(renderPage()) }) }
function input(id: string) { return renderer.root.findByProps({ 'aria-label': `Draft ${id}` }) }
async function typeDraft() { await act(async () => { input('B').props.onChange({ target: { value: 'Laptop 7 — sensor issue' } }) }) }
function pendingRefresh() {
  let resolve!: (value: { data: unknown[] | null; error: { message: string } | null }) => void
  database.nextStudents = new Promise((done) => { resolve = done })
  return resolve
}
beforeEach(() => { database.centreId = 'centre-a'; database.attendance = []; database.nextStudents = null })
afterEach(async () => { if (renderer) await act(async () => renderer.unmount()) })

describe('register draft retention', () => {
  it('keeps B mounted and its draft intact while saving A refreshes the register', async () => {
    await mount()
    await typeDraft()
    const resolve = pendingRefresh()
    await act(async () => renderer.root.findByProps({ 'aria-label': 'Save A' }).props.onClick())
    expect(input('B').props.value).toBe('Laptop 7 — sensor issue')
    await act(async () => resolve({ data: ['A', 'B'].map((id) => ({ id, full_name: `Student ${id}`, active: true, preferred_day: 'Thursday', preferred_time: '16:00', student_schedules: [] })), error: null }))
    expect(input('B').props.value).toBe('Laptop 7 — sensor issue')
  })

  it('keeps drafts visible after a refresh fails and through a successful retry', async () => {
    await mount()
    await typeDraft()
    const resolve = pendingRefresh()
    await act(async () => renderer.root.findByProps({ 'aria-label': 'Save A' }).props.onClick())
    await act(async () => resolve({ data: null, error: { message: 'Network unavailable' } }))
    expect(input('B').props.value).toBe('Laptop 7 — sensor issue')
    const retry = renderer.root.findAllByType('button').find((button) => button.children.includes('Try again'))!
    await act(async () => retry.props.onClick())
    expect(input('B').props.value).toBe('Laptop 7 — sensor issue')
  })

  it('does not carry a draft into another date', async () => {
    await mount()
    await typeDraft()
    await act(async () => renderer.root.findByProps({ 'aria-label': 'Select register date' }).props.onChange({ target: { value: '2026-11-05' } }))
    expect(input('B').props.value).toBe('')
  })

  it('does not carry drafts across centres or accept a late refresh from the old centre', async () => {
    await mount()
    await typeDraft()
    const resolve = pendingRefresh()
    await act(async () => renderer.root.findByProps({ 'aria-label': 'Save A' }).props.onClick())
    database.centreId = 'centre-b'
    await act(async () => renderer.update(renderPage()))
    expect(input('B').props.value).toBe('')
    await act(async () => resolve({ data: [{ id: 'stale', full_name: 'Stale student', active: true, preferred_day: 'Thursday', preferred_time: '16:00' }], error: null }))
    expect(renderer.root.findAllByProps({ 'aria-label': 'Draft stale' })).toHaveLength(0)
    expect(input('B').props.value).toBe('')
  })
})

function isHidden(node: ReturnType<typeof input>) {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (typeof parent.props.className === 'string' && parent.props.className.split(' ').includes('hidden')) return true
  }
  return false
}

describe('register search and filters', () => {
  it('keeps an unfinished entry intact when hidden by search and shown again', async () => {
    await mount()
    await typeDraft()
    await act(async () => renderer.root.findByProps({ 'aria-label': 'Search register students' }).props.onChange({ target: { value: 'Student A' } }))
    expect(isHidden(input('B'))).toBe(true)
    expect(isHidden(input('A'))).toBe(false)
    await act(async () => renderer.root.findByProps({ 'aria-label': 'Search register students' }).props.onChange({ target: { value: '' } }))
    expect(isHidden(input('B'))).toBe(false)
    expect(input('B').props.value).toBe('Laptop 7 — sensor issue')
  })
  it('limits select all to the shown students', async () => {
    await mount()
    await act(async () => renderer.root.findByProps({ 'aria-label': 'Search register students' }).props.onChange({ target: { value: 'Student A' } }))
    await act(async () => renderer.root.findByProps({ 'aria-label': 'Select all visible students' }).props.onChange({ target: { checked: true } }))
    expect(renderer.root.findByProps({ 'aria-label': 'Select Student A' }).props.checked).toBe(true)
    expect(renderer.root.findByProps({ 'aria-label': 'Select Student B' }).props.checked).toBe(false)
  })
  it('finds students who attended but have no recorded session details', async () => {
    database.attendance = [{ student_id: 'A', status: 'Arrived' }, { student_id: 'B', status: 'Absent' }]
    await mount()
    await act(async () => renderer.root.findByProps({ 'aria-label': 'Filter register by attendance' }).props.onChange({ target: { value: 'missing_details' } }))
    expect(isHidden(input('A'))).toBe(false)
    expect(isHidden(input('B'))).toBe(true)
    await act(async () => renderer.root.findByProps({ 'aria-label': 'Filter register by attendance' }).props.onChange({ target: { value: 'absent' } }))
    expect(isHidden(input('A'))).toBe(true)
    expect(isHidden(input('B'))).toBe(false)
  })
  it('ignores a save callback from a date the user has already left', async () => {
    await mount()
    const saveOnOldDate = renderer.root.findByProps({ 'aria-label': 'Save A' }).props.onClick
    await act(async () => renderer.root.findByProps({ 'aria-label': 'Select register date' }).props.onChange({ target: { value: '2026-11-05' } }))
    await act(async () => saveOnOldDate())
    expect(renderer.root.findByProps({ 'aria-label': 'Select register date' }).props.value).toBe('2026-11-05')
    expect(input('B')).toBeDefined()
  })
})
