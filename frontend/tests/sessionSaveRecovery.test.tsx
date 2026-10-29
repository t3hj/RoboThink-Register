import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import SessionEntryRow from '../src/components/SessionEntryRow'
import type { Attendance, Lesson, Student } from '../src/types'
const backend = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('../src/lib/supabaseClient', () => ({ supabase: { rpc: backend.rpc } }))
vi.mock('../src/lib/auth', () => ({ useAuth: () => ({ profile: { id: 'staff' } }) }))
vi.mock('../src/components/Toast', () => ({ useToast: () => ({ notify: vi.fn() }) }))
let renderer: ReactTestRenderer
afterEach(async () => { if (renderer) await act(async () => renderer.unmount()) })
it('retains the selected lesson after a failed save and shows the failure beside the student', async () => {
  backend.rpc.mockResolvedValue({ data: null, error: { message: 'Failed to fetch' } })
  const lesson = { id: 'lesson-a', level_id: 1, lesson_number: 2, title: 'Sensor build', lesson_kind: 'normal' } as Lesson
  const changed = vi.fn()
  await act(async () => { renderer = create(<SessionEntryRow student={{ id: 'student-a', full_name: 'Test Student', current_lesson_id: lesson.id, current_level_id: 1 } as Student} date="2026-10-29" dayLabel="Thursday" levels={[]} lessons={[lesson]} attendance={{ status: 'Arrived' } as Attendance} sessionsToday={[]} projects={[]} plan={null} feedbackBySessionId={new Map()} previouslyCompleted={new Map()} onChanged={changed} />) })
  await act(async () => { renderer.root.findAllByType('button').find((button) => button.children.includes('Save'))!.props.onClick() })
  const alert = renderer.root.findByProps({ role: 'alert' })
  expect(JSON.stringify(alert.children.map((child) => typeof child === 'string' ? child : child.children))).toContain('Test Student')
  expect(JSON.stringify(renderer.toJSON())).toContain("Couldn't reach the server")
  expect(JSON.stringify(renderer.toJSON())).toContain('Sensor build')
  expect(changed).not.toHaveBeenCalled()
  expect(backend.rpc).toHaveBeenCalledWith('record_attended_session', expect.objectContaining({ in_actual_lesson_id: 'lesson-a' }))
  expect(renderer.root.findAllByType('button').find((button) => button.children.includes('Save'))!.props.disabled).toBe(false)
})
