import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import SessionEntryRow from '../src/components/SessionEntryRow'
import type { Attendance, Lesson, Student } from '../src/types'
const backend = vi.hoisted(() => ({ rpc: vi.fn(), upsert: vi.fn() }))
vi.mock('../src/lib/supabaseClient', () => ({ supabase: { rpc: backend.rpc, from: () => ({ upsert: backend.upsert }) } }))
vi.mock('../src/lib/auth', () => ({ useAuth: () => ({ profile: { id: 'staff' } }) }))
vi.mock('../src/components/Toast', () => ({ useToast: () => ({ notify: vi.fn() }) }))
const lesson = { id: 'lesson-1', level_id: 1, lesson_number: 1, title: 'Sensor build', lesson_kind: 'normal' } as Lesson
const base = { student: { id: 'student', full_name: 'Test Student', current_lesson_id: 'lesson-1', current_level_id: 1 } as Student, date: '2026-10-29', dayLabel: 'Thursday', levels: [], lessons: [lesson], sessionsToday: [], projects: [], plan: null, feedbackBySessionId: new Map(), previouslyCompleted: new Map(), onChanged: vi.fn() }
let renderer: ReactTestRenderer
beforeEach(() => { backend.upsert.mockResolvedValue({ error: null }); backend.rpc.mockResolvedValue({ data: null, error: null }); base.onChanged.mockClear() })
afterEach(async () => { if (renderer) await act(async () => renderer.unmount()) })
const button = (name: string) => renderer.root.findAllByType('button').find((element) => element.children.includes(name))!
const toggle = async (open: boolean) => { await act(async () => renderer.root.findByType('details').props.onToggle({ currentTarget: { open } })) }

describe('compact session entries', () => {
  it('keeps attendance visible and preserves unfinished details when collapsed and refreshed', async () => {
    await act(async () => { renderer = create(<SessionEntryRow {...base} attendance={{ status: 'Arrived' } as Attendance} />) })
    expect(button('Attended').props['aria-pressed']).toBe(true)
    expect(renderer.root.findByType('details').props.open).toBe(false)
    await toggle(true)
    await act(async () => button('Not Finished').props.onClick())
    await toggle(false)
    await act(async () => renderer.update(<SessionEntryRow {...base} attendance={{ status: 'Arrived' } as Attendance} />))
    await toggle(true)
    expect(button('Not Finished').props.className).toContain('rt-yellow')
    expect(JSON.stringify(renderer.toJSON())).toContain('Unsaved changes')
    await act(async () => button('Save').props.onClick())
    expect(backend.rpc).toHaveBeenCalledWith('record_attended_session', expect.objectContaining({ in_outcome: 'not_finished', in_actual_lesson_id: 'lesson-1' }))
    expect(renderer.root.findByType('details').props.open).toBe(false)
  })
  it('opens session details when a student is marked attended', async () => {
    await act(async () => { renderer = create(<SessionEntryRow {...base} attendance={null} />) })
    expect(renderer.root.findAllByType('details')).toHaveLength(0)
    await act(async () => button('Attended').props.onClick())
    expect(base.onChanged).toHaveBeenCalledTimes(1)
    await act(async () => renderer.update(<SessionEntryRow {...base} attendance={{ status: 'Arrived' } as Attendance} />))
    expect(renderer.root.findByType('details').props.open).toBe(true)
  })
  it('keeps the entry expanded and editable after a failed save', async () => {
    backend.rpc.mockResolvedValue({ error: { message: 'Failed to fetch' } })
    await act(async () => { renderer = create(<SessionEntryRow {...base} attendance={{ status: 'Arrived' } as Attendance} />) })
    await toggle(true)
    await act(async () => button('Save').props.onClick())
    expect(renderer.root.findByType('details').props.open).toBe(true)
    expect(renderer.root.findAllByProps({ role: 'alert' })).toHaveLength(1)
    expect(button('Save').props.disabled).toBe(false)
  })
})
