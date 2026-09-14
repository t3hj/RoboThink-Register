import { describe, it, expect } from 'vitest'
import { friendlyMessage } from '../src/lib/errors'

describe('friendlyMessage', () => {
  it('never returns the raw RLS/constraint text', () => {
    expect(friendlyMessage('new row violates row-level security policy for table "students"')).toBe(
      "You don't have permission to do that.",
    )
    expect(friendlyMessage('duplicate key value violates unique constraint "students_pkey"')).toBe(
      'That record already exists.',
    )
  })

  it('passes through our own clear RPC error messages unchanged', () => {
    expect(friendlyMessage('Remediation must be resolved first')).toBe('Remediation must be resolved first')
    expect(friendlyMessage('Student has no current lesson')).toBe('Student has no current lesson')
  })

  it('falls back to a generic, non-alarming message for unrecognised errors', () => {
    const result = friendlyMessage('unexpected token at or near "$1" in prepared statement S_3')
    expect(result).not.toContain('$1')
    expect(result).not.toContain('prepared statement')
  })

  it('handles empty/null input', () => {
    expect(friendlyMessage(null)).toBe('Something went wrong. Please try again.')
    expect(friendlyMessage('')).toBe('Something went wrong. Please try again.')
  })
})
