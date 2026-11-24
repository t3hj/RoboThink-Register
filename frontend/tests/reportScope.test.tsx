import { act, create } from 'react-test-renderer'
import { expect, it, vi } from 'vitest'
import Reports from '../src/pages/Reports'
import { StatCard } from '../src/components/ui'

vi.mock('../src/lib/dates', async (original) => ({
  ...await original<typeof import('../src/lib/dates')>(), todayISO: () => '2026-11-24',
}))
vi.mock('../src/lib/curriculumData', () => ({ loadCurriculum: async () => ({
  levels: [{ id: 1, name: 'Junior' }], lessons: [{ id: 'assessment', level_id: 1, lesson_number: 7 }],
}) }))
vi.mock('../src/lib/supabaseClient', () => ({
  supabase: { from: (table: string) => {
    const date = '2026-11-23'
    const rows: Record<string, Record<string,unknown>[]> = {
      students: ['a','b'].map(id => ({ id, active: true, full_name: id })),
      attendance: ['a','b'].map(student_id => ({ id: student_id, student_id, date, status: 'Completed' })),
      attended_sessions: [1,2].map(n => ({ id: String(n), student_id: 'a', session_number: n, date, outcome: 'completed', actual_lesson_id: 'assessment' })),
      assessments: [{ student_id: 'a', passed: false, attended_session_id: '1' }, { student_id: 'b', passed: true }],
      remediation_plans: [{ student_id: 'a', status: 'required' }],
    }
    const query = {
      select: () => query, order: () => query, eq: () => query, neq: () => query, gte: () => query, lte: () => query,
      range: async (first: number, last: number) => ({ data: (rows[table] ?? []).slice(first, last + 1), error: null }),
    }
    return query
  } },
}))
it('applies the student filter to attendance, results, remediation, overview and curriculum completions', async () => {
  const view = await act(async () => ({ renderer: create(<Reports />) }))
  const root = view.renderer.root
  const stat = (label: string) => root.findAllByType(StatCard).find(card => card.props.label === label)?.props.value
  await act(async () => root.findAllByType('select')[1].props.onChange({ target: { value: 'a' } }))
  expect(stat('Sessions attended')).toBe(2)
  expect(stat('Register marks')).toBe(1)
  expect(stat('Failed')).toBe(1)
  expect(stat('Passed')).toBe(0)
  expect(stat('In remediation')).toBe(1)
  expect(stat('Total students')).toBe(1)
  expect(JSON.stringify(view.renderer.toJSON())).toContain('By instructor')
  await act(async () => view.renderer.unmount())
})
