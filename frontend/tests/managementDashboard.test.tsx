import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import ManagementDashboard from '../src/pages/ManagementDashboard'
import { StatCard } from '../src/components/ui'

type Row = Record<string, unknown>
const backend = vi.hoisted(() => ({
  centre: 'a' as string | null,
  all: false,
  brand: 'robothink',
  tables: {} as Record<string, Row[]>,
  calls: [] as { table: string; filters: [string, unknown][] }[],
  saves: [] as Row[],
  failSave: false,
  delay: null as Promise<void> | null,
  notify: vi.fn(),
}))
vi.mock('../src/lib/auth', () => ({ useAuth: () => ({ role: 'management', profile: { id: 'staff' } }) }))
vi.mock('../src/lib/brand', () => ({ useBrand: () => ({ activeBrand: backend.brand }) }))
vi.mock('../src/lib/centres', () => ({
  useCentres: () => ({
    selectedCentreId: backend.centre,
    selectedCentre: { name: `Centre ${backend.centre}` },
    isAllCentres: backend.all,
    centres: [
      { id: 'a', name: 'Centre A' },
      { id: 'b', name: 'Centre B' },
    ],
    loading: false,
    error: null,
    refresh: vi.fn(),
  }),
}))
vi.mock('../src/components/Toast', () => ({ useToast: () => ({ notify: backend.notify }) }))
vi.mock('../src/lib/dates', async (original) => ({
  ...(await original<typeof import('../src/lib/dates')>()),
  todayISO: () => '2026-11-17',
}))
vi.mock('../src/lib/supabaseClient', () => ({
  supabase: {
    from: (table: string) => {
      const filters: [string, unknown][] = []
      let single = false
      let start = 0
      let end = Infinity
      let save: Row | null = null
      const wait = table === 'students' ? backend.delay : null
      if (table === 'students') backend.delay = null
      const query = {
        select: () => query,
        order: () => query,
        eq: (column: string, value: unknown) => {
          filters.push([column, value])
          return query
        },
        in: (column: string, value: unknown[]) => {
          filters.push([column, value])
          return query
        },
        range: (from: number, to: number) => {
          start = from
          end = to + 1
          return query
        },
        maybeSingle: () => {
          single = true
          return query
        },
        upsert: (value: Row, options: Row) => {
          save = value
          backend.saves.push({ ...value, options })
          return query
        },
        then: async (resolve: (value: unknown) => unknown) => {
          const data = (backend.tables[table] ?? [])
            .filter((row) =>
              filters.every(([key, value]) => (Array.isArray(value) ? value.includes(row[key]) : row[key] === value)),
            )
            .slice(start, end)
          if (wait) await wait
          backend.calls.push({ table, filters })
          if (save)
            return resolve(
              backend.failSave
                ? { data: null, error: { message: 'Save failed' } }
                : { data: { id: 'saved-followup', ...save }, error: null },
            )
          return resolve({ data: single ? (data[0] ?? null) : data, error: null })
        },
      }
      return query
    },
  },
}))
let renderer: ReactTestRenderer
const page = () => (
  <MemoryRouter>
    <ManagementDashboard />
  </MemoryRouter>
)
async function mount() {
  await act(async () => {
    renderer = create(page())
  })
}
const stat = (label: string) =>
  renderer.root.findAllByType(StatCard).find((card) => card.props.label === label)!.props.value
const button = (text: string) => renderer.root.findAllByType('button').find((node) => node.children.includes(text))!
beforeEach(() => {
  backend.centre = 'a'
  backend.all = false
  backend.brand = 'robothink'
  backend.calls = []
  backend.saves = []
  backend.failSave = false
  backend.delay = null
  backend.notify.mockClear()
  backend.tables = {
    students: ['a', 'b', 'c'].map((id) => ({
      id,
      full_name: `Student ${id.toUpperCase()}`,
      active: true,
      centre_id: id === 'c' ? 'a' : id,
      brand: id === 'c' ? 'creative_iq' : 'robothink',
      preferred_day: 'Monday',
      date_joined: '2026-10-01',
      subscriptions: { name: 'Term Time' },
    })),
    attendance: [
      ...Array.from({ length: 11 }, (_, index) => ({
        id: `old-${index}`,
        student_id: 'a',
        date: `2026-10-${String(index + 1).padStart(2, '0')}`,
        status: 'Completed',
        session_type: 'regular',
      })),
      ...['a', 'b', 'c'].map((id) => ({
        id: `today-${id}`,
        student_id: id,
        date: '2026-11-16',
        status: 'Completed',
        session_type: 'regular',
      })),
    ],
    attended_sessions: [],
    feedback_sheets: [],
    term_time_followups: [],
  }
})
afterEach(async () => {
  if (renderer) await act(async () => renderer.unmount())
})

it('shows named lists and scopes all student-owned reads to the selected centre and brand', async () => {
  await mount()
  expect(stat('Students attended')).toBe(1)
  expect(stat('Sessions attended')).toBe(1)
  expect(stat('Term-time follow-ups due')).toBe(1)
  const text = JSON.stringify(renderer.toJSON())
  expect(text).toContain('Student A')
  expect(text).not.toContain('Student B')
  expect(text).not.toContain('Student C')
  for (const call of backend.calls.filter((call) => call.table !== 'students'))
    expect(call.filters).toContainEqual(['student_id', ['a']])
})
it('updates period totals and named lists when Last week is selected', async () => {
  await mount()
  await act(async () => button('Last week').props.onClick())
  expect(stat('Sessions attended')).toBe(0)
  expect(stat('Term-time follow-ups due')).toBe(1)
})
it('allows management to save contact status, notes and a next-contact date for a 12-session block', async () => {
  await mount()
  await act(async () => button('Update follow-up').props.onClick())
  await act(async () => renderer.root.findByType('select').props.onChange({ target: { value: 'contacted' } }))
  await act(async () => renderer.root.findByType('textarea').props.onChange({ target: { value: 'Parent called' } }))
  const nextDate = renderer.root
    .findAllByType('input')
    .find((node) => node.props.type === 'date' && node.props.value === '')!
  await act(async () => nextDate.props.onChange({ target: { value: '2026-11-24' } }))
  await act(async () => button('Save follow-up').props.onClick())
  expect(backend.saves[0]).toMatchObject({
    student_id: 'a',
    session_block: 1,
    status: 'contacted',
    notes: 'Parent called',
    next_follow_up_date: '2026-11-24',
    updated_by: 'staff',
    options: { onConflict: 'student_id,session_block' },
  })
  expect(stat('Awaiting parent reply')).toBe(1)
  expect(stat('Term-time follow-ups due')).toBe(0)
})
it('keeps failed follow-up edits available for retry', async () => {
  backend.failSave = true
  await mount()
  await act(async () => button('Update follow-up').props.onClick())
  await act(async () => renderer.root.findByType('textarea').props.onChange({ target: { value: 'Keep this note' } }))
  await act(async () => button('Save follow-up').props.onClick())
  expect(renderer.root.findByType('textarea').props.value).toBe('Keep this note')
  expect(renderer.root.findAllByProps({ role: 'alert' })).toHaveLength(1)
})
it('requires a next-contact date when a follow-up is postponed', async () => {
  await mount()
  await act(async () => button('Update follow-up').props.onClick())
  await act(async () => renderer.root.findByType('select').props.onChange({ target: { value: 'snoozed' } }))
  await act(async () => button('Save follow-up').props.onClick())
  expect(backend.saves).toHaveLength(0)
  expect(renderer.root.findByProps({ role: 'alert' }).children.join('')).toContain('Choose a date')
})
it('refreshes centre scope without displaying stale students', async () => {
  await mount()
  backend.centre = 'b'
  await act(async () => renderer.update(page()))
  expect(JSON.stringify(renderer.toJSON())).toContain('Student B')
  expect(JSON.stringify(renderer.toJSON())).not.toContain('Student A')
})
it('does not issue unfiltered reads for an empty centre', async () => {
  backend.centre = 'empty'
  await mount()
  expect(stat('Sessions attended')).toBe(0)
  expect(backend.calls.every((call) => call.table === 'students')).toBe(true)
})
it('combines only the active brand when All centres is selected', async () => {
  backend.centre = null
  backend.all = true
  await mount()
  expect(stat('Students attended')).toBe(2)
  expect(JSON.stringify(renderer.toJSON())).not.toContain('Student C')
})
it('ignores a slow result from the previously selected centre', async () => {
  let finish!: () => void
  backend.delay = new Promise<void>((resolve) => {
    finish = resolve
  })
  await mount()
  backend.centre = 'b'
  await act(async () => renderer.update(page()))
  await act(async () => finish())
  expect(JSON.stringify(renderer.toJSON())).toContain('Student B')
  expect(JSON.stringify(renderer.toJSON())).not.toContain('Student A')
})
