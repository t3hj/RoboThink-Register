import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// A transform (or filter, will-change, etc.) on the element that wraps every
// page makes it the containing block for position:fixed descendants, which
// displaces every modal. Keep the page-enter animation to opacity only.
describe('page wrapper animation', () => {
  const css = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8')
  const block = (name: string) => {
    const start = css.indexOf(name)
    return css.slice(start, css.indexOf('\n}', start) + 2)
  }

  it('does not animate transform, filter or will-change', () => {
    const rule = block('.page-enter {') + block('@keyframes page-enter')
    expect(rule).not.toMatch(/transform|filter|will-change|perspective/)
  })

  it('modals render through the body-level overlay', () => {
    const ui = readFileSync(new URL('../src/components/ui.tsx', import.meta.url), 'utf8')
    expect(ui).toContain('createPortal')
    for (const file of ['StudentForm', 'AddToRegister', 'BulkAttendanceModal', 'BulkFeedbackModal', 'BulkSessionModal']) {
      const source = readFileSync(new URL(`../src/components/${file}.tsx`, import.meta.url), 'utf8')
      expect(source, file).not.toContain('fixed inset-0')
    }
  })
})
