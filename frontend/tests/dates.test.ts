import { describe, it, expect } from 'vitest'
import {
  toLocalISODate,
  todayISO,
  parseISODate,
  dayName,
  dayIndex,
  nowHM,
  formatDisplayDate,
  addDays,
} from '../src/lib/dates'

describe('toLocalISODate', () => {
  it('formats a local date without timezone shifting', () => {
    // 23:30 local on 15 Jan — toISOString().slice would give the 16th (UTC)
    const d = new Date(2025, 0, 15, 23, 30)
    expect(toLocalISODate(d)).toBe('2025-01-15')
  })
  it('zero-pads month and day', () => {
    expect(toLocalISODate(new Date(2025, 2, 5))).toBe('2025-03-05')
  })
})

describe('todayISO', () => {
  it('returns a YYYY-MM-DD string', () => {
    expect(todayISO()).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})

describe('parseISODate', () => {
  it('parses as local midnight, not UTC', () => {
    const d = parseISODate('2025-07-10')
    expect(d.getFullYear()).toBe(2025)
    expect(d.getMonth()).toBe(6)
    expect(d.getDate()).toBe(10)
  })
})

describe('dayName', () => {
  it('maps known dates to days (UK local)', () => {
    expect(dayName('2025-09-09')).toBe('Tuesday')
    expect(dayName('2025-09-14')).toBe('Sunday')
  })
  it('is stable across DST changes (clocks go back 26 Oct 2025 UK)', () => {
    // Parsing 'YYYY-MM-DD' as local must not jump a day around DST transitions
    expect(dayName('2025-10-26')).toBe('Sunday')
    expect(dayName('2025-03-30')).toBe('Sunday')
  })
})

describe('dayIndex', () => {
  it('matches Date.getDay() numbering', () => {
    expect(dayIndex('Monday')).toBe(1)
    expect(dayIndex('sunday')).toBe(0)
    expect(dayIndex('NoSuchDay')).toBe(-1)
  })
})

describe('nowHM', () => {
  it('returns HH:MM', () => {
    expect(nowHM()).toMatch(/^\d{2}:\d{2}$/)
  })
})

describe('formatDisplayDate', () => {
  it('formats en-GB', () => {
    expect(formatDisplayDate('2025-09-09')).toContain('Sep')
    expect(formatDisplayDate('2025-09-09')).toContain('2025')
  })
})

describe('addDays', () => {
  it('adds and subtracts days across month boundaries', () => {
    expect(addDays('2025-09-30', 1)).toBe('2025-10-01')
    expect(addDays('2025-10-01', -1)).toBe('2025-09-30')
    expect(addDays('2025-03-01', -1)).toBe('2025-02-28') // non-leap year
  })
  it('handles leap years', () => {
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29')
  })
})
