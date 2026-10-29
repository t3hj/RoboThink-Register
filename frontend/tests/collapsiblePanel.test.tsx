// @vitest-environment happy-dom
import { act, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it } from 'vitest'
import CollapsiblePanel from '../src/components/CollapsiblePanel'

it('shows its count when collapsed and keeps child state when toggled or refreshed', async () => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host)
  function StatefulChild() { const [value, setValue] = useState(0); return <button onClick={() => setValue((old) => old + 1)}>Draft {value}</button> }
  const panel = (count: number) => <CollapsiblePanel title="Feedback reminders" countLabel={`${count} outstanding`}><StatefulChild /></CollapsiblePanel>
  try {
    await act(async () => root.render(panel(3)))
    const details = host.querySelector('details')!
    expect(details.open).toBe(false)
    expect(details.querySelector('summary')!.textContent).toContain('3 outstanding')
    details.open = true
    await act(async () => host.querySelector('button')!.click())
    details.open = false
    await act(async () => root.render(panel(2)))
    expect(details.open).toBe(false)
    expect(host.querySelector('button')!.textContent).toBe('Draft 1')
    expect(details.querySelector('summary')!.textContent).toContain('2 outstanding')
    details.open = true
    await act(async () => root.render(panel(1)))
    expect(details.open).toBe(true)
  } finally { await act(async () => root.unmount()); host.remove() }
})
