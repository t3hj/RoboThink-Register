// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ConfirmDialog, ModalOverlay } from '../src/components/ui'

let root: Root
let trigger: HTMLButtonElement
beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  document.body.innerHTML = '<button id="trigger">Open</button><div id="root"></div>'
  trigger = document.querySelector('#trigger')!
  trigger.focus()
  root = createRoot(document.querySelector('#root')!)
  // happy-dom has no layout engine; every test control is visibly rendered.
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([{ width: 20, height: 20 }] as unknown as DOMRectList)
})
afterEach(async () => { await act(async () => root.unmount()); vi.restoreAllMocks(); document.body.style.overflow = '' })
const key = (value: string, shiftKey = false) => document.dispatchEvent(new KeyboardEvent('keydown', { key: value, shiftKey, bubbles: true, cancelable: true }))
function content(onClose: () => void, dismissible = true) {
  return <ModalOverlay onClose={onClose} dismissible={dismissible}><div role="dialog" aria-label="Test"><input id="first" /><button id="last">Save</button></div></ModalOverlay>
}

describe('dialog keyboard and dismissal behaviour', () => {
  it('focuses the dialog, wraps Tab both ways and restores the opening control', async () => {
    await act(async () => root.render(content(vi.fn())))
    expect(document.activeElement?.id).toBe('first')
    key('Tab', true)
    expect(document.activeElement?.id).toBe('last')
    key('Tab')
    expect(document.activeElement?.id).toBe('first')
    trigger.focus()
    expect(document.activeElement?.id).toBe('first')
    await act(async () => root.render(null))
    expect(document.activeElement).toBe(trigger)
  })
  it('ignores Escape and backdrop clicks while saving, then permits dismissal', async () => {
    const close = vi.fn()
    await act(async () => root.render(content(close, false)))
    key('Escape')
    document.querySelector('[tabindex="-1"]')!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(close).not.toHaveBeenCalled()
    await act(async () => root.render(content(close, true)))
    key('Escape')
    expect(close).toHaveBeenCalledTimes(1)
  })
  it('only dismisses the topmost nested overlay and restores the original scroll style', async () => {
    const outer = vi.fn(); const inner = vi.fn()
    document.body.style.overflow = 'auto'
    const outerDialog = <ModalOverlay key="outer" onClose={outer}><div role="dialog" aria-label="Outer"><button>Outer</button></div></ModalOverlay>
    const innerDialog = <ModalOverlay key="inner" onClose={inner}><div role="dialog" aria-label="Inner"><button>Inner</button></div></ModalOverlay>
    await act(async () => root.render(<>{outerDialog}{innerDialog}</>))
    key('Escape')
    expect(inner).toHaveBeenCalledTimes(1)
    expect(outer).not.toHaveBeenCalled()
    await act(async () => root.render(<>{innerDialog}</>))
    expect(document.body.style.overflow).toBe('hidden')
    await act(async () => root.render(null))
    expect(document.body.style.overflow).toBe('auto')
  })
  it('gives confirmation dialogs an accessible title', async () => {
    await act(async () => root.render(<ConfirmDialog open title="Remove session?" message="Review before removing." onConfirm={vi.fn()} onCancel={vi.fn()} />))
    const dialog = document.querySelector('[role="dialog"]')!
    expect(document.getElementById(dialog.getAttribute('aria-labelledby')!)?.textContent).toBe('Remove session?')
  })
})
