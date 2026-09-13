import { describe, it, expect } from 'vitest'
import { parseLevelName, levelLabel, groupByProgramme } from '../src/lib/curriculum'

describe('parseLevelName', () => {
  it('splits a termed level name into programme + term', () => {
    expect(parseLevelName('Engineer - Term 2')).toEqual({ programme: 'Engineer', term: 2 })
  })
  it('treats a non-termed level name as the whole programme', () => {
    expect(parseLevelName('Expert Engineer')).toEqual({ programme: 'Expert Engineer', term: null })
  })
})

describe('levelLabel', () => {
  it('formats a termed level', () => {
    expect(levelLabel({ name: 'Junior Engineer - Term 6' })).toBe('Junior Engineer — Term 6')
  })
  it('formats a non-termed level', () => {
    expect(levelLabel({ name: 'Master Engineer' })).toBe('Master Engineer')
  })
  it('handles null', () => {
    expect(levelLabel(null)).toBe('—')
  })
})

describe('groupByProgramme', () => {
  it('groups terms under their programme, ordered by sort_order', () => {
    const levels = [
      { name: 'Engineer - Term 2', sort_order: 8 },
      { name: 'Engineer - Term 1', sort_order: 7 },
      { name: 'Coding', sort_order: 50 },
    ]
    const groups = groupByProgramme(levels)
    expect(groups.map((g) => g.programme)).toEqual(['Engineer', 'Coding'])
    expect(groups[0].levels.map((l) => l.name)).toEqual(['Engineer - Term 1', 'Engineer - Term 2'])
  })
})
