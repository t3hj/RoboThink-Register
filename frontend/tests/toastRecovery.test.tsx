import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider, useToast } from '../src/components/Toast'
let notifications: ReturnType<typeof useToast>
let renderer: ReactTestRenderer
function Consumer() { notifications = useToast(); return null }
afterEach(async () => { if (renderer) await act(async () => renderer.unmount()); vi.useRealTimers() })
describe('recoverable notifications', () => {
  it('keeps errors visible until dismissed while successes still expire', async () => {
    vi.useFakeTimers()
    await act(async () => { renderer = create(<ToastProvider><Consumer /></ToastProvider>) })
    await act(async () => { notifications.notify('Save failed — please retry.', 'error'); notifications.notify('Attendance saved', 'success') })
    await act(async () => { vi.advanceTimersByTime(30_000) })
    expect(renderer.root.findAllByProps({ role: 'alert' })).toHaveLength(1)
    expect(renderer.root.findAllByProps({ role: 'status' })).toHaveLength(0)
    await act(async () => renderer.root.findByProps({ 'aria-label': 'Dismiss notification' }).props.onClick())
    expect(renderer.root.findAllByProps({ role: 'alert' })).toHaveLength(0)
  })
})
