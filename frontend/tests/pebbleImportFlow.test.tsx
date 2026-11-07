import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import ImportStudents from '../src/pages/ImportStudents'
const mock = vi.hoisted(() => ({ read: vi.fn(), load: vi.fn(), insert: vi.fn(), schedules: vi.fn(), notify: vi.fn() }))
vi.mock('read-excel-file/browser', () => ({ readSheet: mock.read }))
vi.mock('../src/lib/brand', () => ({ useBrand: () => ({ activeBrand: 'robothink' }) }))
vi.mock('../src/lib/centres', () => ({ useCentres: () => ({ selectedCentreId: 'centre', activeCentres: [{ id: 'centre', name: 'Test centre' }] }) }))
vi.mock('../src/components/Toast', () => ({ useToast: () => ({ notify: mock.notify }) }))
vi.mock('../src/lib/supabaseClient', () => ({ supabase: { from: (table: string) => {
  if (table === 'subscriptions') return { select: () => ({ order: async () => ({ data: [{ id: 1, name: 'Term Time' }] }) }) }
  if (table === 'student_schedules') return { insert: mock.schedules }
  return { select: () => ({ eq: () => ({ limit: mock.load }) }), insert: mock.insert }
} } }))
let renderer: ReactTestRenderer
const importButton = () => renderer.root.findAllByType('button').find(b => b.children.join('').startsWith('Import '))!
async function mountAndRead() {
  await act(async () => { renderer = create(<MemoryRouter><ImportStudents /></MemoryRouter>) })
  await act(async () => { renderer.root.findByProps({ type: 'file' }).props.onChange({ target: { files: [{ name: 'register.xlsx' }] } }) })
}
beforeEach(() => {
  mock.read.mockReset().mockResolvedValue([['Date of session', '07/11/2026'], ['Time of session', '10:00'], ['child', 'ticket'], ['Ada Example', 'Full Term Ticket']])
  mock.load.mockReset().mockResolvedValue({ data: [], error: null })
  mock.insert.mockReset().mockResolvedValue({ error: null })
  mock.schedules.mockReset().mockResolvedValue({ error: null })
  mock.notify.mockReset()
})
afterEach(async () => { if (renderer) await act(async () => renderer.unmount()) })
it('requires a session time before writing any students', async () => {
  mock.read.mockResolvedValue([['child', 'ticket'], ['Ada Example', 'Full Term Ticket']])
  await mountAndRead()
  expect(importButton().props.disabled).toBe(true)
  await act(async () => importButton().props.onClick())
  expect(mock.insert).not.toHaveBeenCalled()
})
it('shows a recoverable lookup error instead of checking students forever', async () => {
  mock.load.mockResolvedValueOnce({ error: { message: 'Network unavailable' } })
  await mountAndRead()
  expect(renderer.root.findByProps({ role: 'alert' }).children.join('')).toContain('Network unavailable')
  await act(async () => renderer.root.findAllByType('button').find(b => b.children.join('') === 'Retry')!.props.onClick())
  expect(importButton().props.disabled).toBe(false)
})
it('reloads after a partial import and retries schedules without creating the student twice', async () => {
  mock.schedules.mockResolvedValueOnce({ error: { message: 'Temporary failure' } })
  await mountAndRead()
  mock.load.mockResolvedValue({ data: [{ id: 'saved', full_name: 'Ada Example', active: true, student_schedules: [] }], error: null })
  await act(async () => importButton().props.onClick())
  expect(mock.insert).toHaveBeenCalledTimes(1)
  expect(importButton().children.join('')).toContain('0 new')
  await act(async () => importButton().props.onClick())
  expect(mock.insert).toHaveBeenCalledTimes(1)
  expect(mock.schedules).toHaveBeenCalledTimes(2)
  expect(mock.schedules.mock.calls[1][0][0]).toMatchObject({ student_id: 'saved', day_of_week: 'Saturday', start_time: '10:00' })
})
it('allows a names-only export once staff choose its subscription and session', async () => {
  mock.read.mockResolvedValue([['Child name'], ['Ada Example']])
  await mountAndRead()
  expect(importButton().props.disabled).toBe(true)
  await act(async () => {
    const selects = renderer.root.findAllByType('select')
    selects[1].props.onChange({ target: { value: 'Saturday' } })
    selects[2].props.onChange({ target: { value: '1' } })
    renderer.root.findByProps({ type: 'time' }).props.onChange({ target: { value: '10:00' } })
  })
  expect(importButton().props.disabled).toBe(false)
  await act(async () => importButton().props.onClick())
  expect(mock.insert.mock.calls[0][0][0]).toMatchObject({ full_name: 'Ada Example', subscription_id: 1, date_of_birth: null, parent_contact: null })
})
