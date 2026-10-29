import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import SessionEntryRow from '../src/components/SessionEntryRow'
import type { Attendance, Lesson, Student, StudentProject } from '../src/types'
const backend = vi.hoisted(() => ({ rpc: vi.fn(), link: vi.fn(), upsert: vi.fn(), projectPayloads: [] as unknown[] }))
vi.mock('../src/lib/supabaseClient', () => ({ supabase: {
  rpc: backend.rpc,
  from: () => ({
    upsert: backend.upsert,
    update: (payload: unknown) => { backend.projectPayloads.push(payload); return { eq: () => ({ select: () => ({ maybeSingle: backend.link }) }) } },
  }),
} }))
vi.mock('../src/lib/auth', () => ({ useAuth: () => ({ profile: { id: 'staff' } }) }))
vi.mock('../src/components/Toast', () => ({ useToast: () => ({ notify: vi.fn() }) }))
const project = { id: 'project-a', student_id: 'student-a', name: 'Test project', status: 'active' } as StudentProject
let renderer: ReactTestRenderer
const button = (name: string) => renderer.root.findAllByType('button').find((element) => element.children.filter((child) => typeof child === 'string').join('').trim() === name)!
async function mount(kind: 'normal' | 'assessment' = 'normal') {
  const lesson = { id: 'lesson-a', level_id: 1, lesson_number: 1, title: 'Test lesson', lesson_kind: kind } as Lesson
  await act(async () => { renderer = create(<SessionEntryRow student={{ id: 'student-a', full_name: 'Test Student', current_lesson_id: lesson.id, current_level_id: 1 } as Student} date="2026-10-29" dayLabel="Thursday" levels={[]} lessons={[lesson]} attendance={{ status: 'Arrived' } as Attendance} sessionsToday={[]} projects={[project]} plan={null} feedbackBySessionId={new Map()} previouslyCompleted={new Map()} onChanged={vi.fn()} />) })
}
beforeEach(() => {
  backend.rpc.mockReset().mockResolvedValue({ data: 'saved-session', error: null })
  backend.link.mockReset().mockResolvedValue({ data: { id: 'saved-session' }, error: null })
  backend.upsert.mockReset().mockResolvedValue({ error: null })
  backend.projectPayloads = []
})
afterEach(async () => { if (renderer) await act(async () => renderer.unmount()) })

describe('recovery after a confirmed session save', () => {
  it.each(['normal', 'assessment'] as const)('never inserts a second %s session when the project link fails', async (kind) => {
    backend.link.mockResolvedValueOnce({ data: null, error: { message: 'Failed to fetch' } })
    await mount(kind)
    await act(async () => renderer.root.findAllByType('select')[0].props.onChange({ target: { value: project.id } }))
    if (kind === 'assessment') await act(async () => button('PASS').props.onClick())
    await act(async () => button('Save').props.onClick())
    expect(backend.rpc).toHaveBeenCalledTimes(1)
    expect(button('Retry remaining updates')).toBeDefined()
    expect(button('Save')).toBeUndefined()
    await act(async () => button('Retry remaining updates').props.onClick())
    expect(backend.rpc).toHaveBeenCalledTimes(1)
    expect(backend.link).toHaveBeenCalledTimes(2)
    expect(backend.upsert).toHaveBeenCalledTimes(1)
    expect(renderer.root.findAllByProps({ role: 'alert' })).toHaveLength(0)
  })
  it('does not repeat a successful project-link write if only attendance failed', async () => {
    backend.upsert.mockResolvedValueOnce({ error: { message: 'Failed to fetch' } })
    await mount()
    await act(async () => renderer.root.findAllByType('select')[0].props.onChange({ target: { value: project.id } }))
    await act(async () => button('Save').props.onClick())
    await act(async () => button('Retry remaining updates').props.onClick())
    expect(backend.rpc).toHaveBeenCalledTimes(1)
    expect(backend.link).toHaveBeenCalledTimes(1)
    expect(backend.upsert).toHaveBeenCalledTimes(2)
  })
  it('records an unfinished project with the correct outcome and attendance, without advancing curriculum', async () => {
    backend.upsert.mockResolvedValueOnce({ error: { message: 'Failed to fetch' } })
    await mount()
    await act(async () => button('Project').props.onClick())
    await act(async () => renderer.root.findAllByType('select')[0].props.onChange({ target: { value: project.id } }))
    await act(async () => button('Not finished').props.onClick())
    await act(async () => button('Save').props.onClick())
    expect(backend.rpc).toHaveBeenCalledWith('record_project_session', { in_student_id: 'student-a', in_project_id: 'project-a', in_outcome: 'not_finished', in_date: '2026-10-29' })
    await act(async () => button('Retry remaining updates').props.onClick())
    expect(backend.rpc).toHaveBeenCalledTimes(1)
    expect(backend.upsert).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'Arrived' }), { onConflict: 'student_id,date' })
    expect(backend.projectPayloads).toHaveLength(0)
    expect(project.status).toBe('active')
  })
  it('does not accept an update that matched no saved session', async () => {
    backend.link.mockResolvedValueOnce({ data: null, error: null })
    await mount()
    await act(async () => renderer.root.findAllByType('select')[0].props.onChange({ target: { value: project.id } }))
    await act(async () => button('Save').props.onClick())
    expect(button('Retry remaining updates')).toBeDefined()
    expect(backend.upsert).not.toHaveBeenCalled()
    await act(async () => button('Retry remaining updates').props.onClick())
    expect(backend.rpc).toHaveBeenCalledTimes(1)
  })
  it('does not reopen a blank save form while the confirmed session is refreshing', async () => {
    await mount()
    await act(async () => button('Save').props.onClick())
    expect(button('Save')).toBeUndefined()
    expect(button('+ Record another session')).toBeDefined()
    await act(async () => button('+ Record another session').props.onClick())
    expect(button('Save')).toBeDefined()
  })
  it('guards against two save clicks before the first response', async () => {
    let resolve!: (value: unknown) => void
    backend.rpc.mockImplementation(() => new Promise((done) => { resolve = done }))
    await mount()
    const save = button('Save').props.onClick
    await act(async () => { save(); save() })
    expect(backend.rpc).toHaveBeenCalledTimes(1)
    await act(async () => resolve({ data: 'saved-session', error: null }))
    expect(backend.upsert).toHaveBeenCalledTimes(1)
  })
})
